import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import compression from "compression";
import fs from "fs";
import crypto from "crypto";
import { createTranscoder, SEG } from "./transcoder.js";
import { createOffline } from "./offline.js";
import { createAuth } from "./auth.js";
import { createImageCache } from "./image-cache.js";
import { createImageGuard, isConnectionDrop, jpegComponents, readHead } from "./image-guard.js";
import { createPlaybackLog, sanitizePlayback, summarizePlayback } from "./playback-log.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
// Préférer l'IP locale LAN (192.168.1.81) pour contourner le Remote Watch Pass Plex, avec fallback Tailscale
const PLEX_URL = (process.env.PLEX_URL || "http://192.168.1.81:32400").replace(/\/$/, "");
const PLEX_TOKEN = process.env.PLEX_TOKEN;
if (!PLEX_TOKEN) {
  console.error("✖ PLEX_TOKEN manquant. Copiez server/.env.example en server/.env et renseignez votre token Plex.");
  process.exit(1);
}
const CLIENT_ID = "nomad-stream-pwa-v1";
// Délai maximal d'une requête de métadonnées ou d'image vers Plex (en-têtes et corps compris)
const PLEX_TIMEOUT_MS = Number(process.env.PLEX_TIMEOUT_MS) || 15000;

// Identité "Plex Web / Chrome" envoyée au transcodeur : sans elle, Plex n'applique aucun profil client,
// ignore les plafonds de débit et recopie le flux d'origine en segments de 10 s (lancement très lent)
const PLEX_WEB_PROFILE = {
  "X-Plex-Product": "Plex Web",
  "X-Plex-Version": "4.120.1",
  "X-Plex-Platform": "Chrome",
  "X-Plex-Device": "Linux",
};

// Paliers de qualité du transcodage HLS. "original" recopie la vidéo sans la réencoder.
// Mesuré sur ce serveur (encodage logiciel) : 720p ≈ 2-4x temps réel, 1080p ≈ 1,5x seulement.
const QUALITY_PRESETS = {
  original: {},
  "1080p": { maxVideoBitrate: "8000", videoResolution: "1920x1080", videoQuality: "90" },
  "720p": { maxVideoBitrate: "4000", videoResolution: "1280x720", videoQuality: "90" },
  "480p": { maxVideoBitrate: "1500", videoResolution: "854x480", videoQuality: "80" },
  "360p": { maxVideoBitrate: "750", videoResolution: "640x360", videoQuality: "70" },
};

const isNumericId = (v) => typeof v === "string" && /^\d{1,12}$/.test(v);
const isSessionId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v);

// Images servies par /api/image : uniquement les chemins d'images que Plex renvoie dans ses
// métadonnées. Sans cette liste, le paramètre `path` permettait de lire n'importe quelle page
// de Plex avec le token admin (réglages, sessions en cours…).
const PLEX_IMAGE_PATHS = [
  /^\/library\/metadata\/\d+\/[A-Za-z]+\/\d+$/, // thumb, art, banner…
  /^\/library\/collections\/\d+\/composite\/\d+$/,
  /^\/playlists\/\d+\/composite\/\d+$/,
  /^\/:\/resources\/[\w-]+\.(?:png|jpe?g)$/, // images par défaut de Plex
];
const isPlexImagePath = (v) => typeof v === "string" && PLEX_IMAGE_PATHS.some((re) => re.test(v));
// Clés de fichier (flux directs) et sous-chemins HLS : jamais de segment "..", qui ferait sortir
// de /library/parts/ (ou de la session) vers n'importe quelle page de Plex
const hasDotSegment = (v) => v.split("/").some((s) => s === "." || s === "..");
const isPartKey = (v) =>
  typeof v === "string" && /^\/library\/parts\/\d+(?:\/[\w.-]+)+$/.test(v) && !hasDotSegment(v);
const isHlsSubpath = (v) => typeof v === "string" && /^[\w.-]+(?:\/[\w.-]+)*$/.test(v) && !hasDotSegment(v);
// Liste fermée : le format sert aussi d'extension au fichier de cache (jamais de valeur libre
// dans un chemin de fichier : `format=/../../etc/passwd` lisait n'importe quel fichier)
const IMAGE_FORMATS = { webp: "image/webp", jpeg: "image/jpeg", png: "image/png" };
const clampInt = (v, def, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || def));

// Un identifiant Plex par appareil : Plex mémorise ses décisions de transcodage par client,
// et deux appareils partageant le même identifiant se gênent mutuellement
function plexClientId(raw) {
  return typeof raw === "string" && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? `nomad-${raw}` : CLIENT_ID;
}

function plexUrl(endpoint, params = {}, clientId = CLIENT_ID) {
  const qs = new URLSearchParams({ ...params, "X-Plex-Token": PLEX_TOKEN, "X-Plex-Client-Identifier": clientId });
  return `${PLEX_URL}${endpoint}${endpoint.includes("?") ? "&" : "?"}${qs}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch vers Plex avec délai maximal avant réception des en-têtes et nouvelles tentatives
// (micro-coupure Tailscale, erreur 5xx). Le délai ne s'applique pas au corps de la réponse :
// un flux peut durer des heures. Si `signal` est annulé (client parti), le corps est coupé aussi.
// `retryIf(erreur)` écarte les erreurs après lesquelles il ne faut pas réessayer.
async function fetchPlex(url, { method = "GET", headers = {}, timeoutMs = 20000, retries = 0, retryIf = () => true, signal } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new Error("Client déconnecté");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Plex n'a pas répondu en ${timeoutMs / 1000} s`)), timeoutMs);
    signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    try {
      const response = await fetch(url, { method, headers, signal: controller.signal });
      clearTimeout(timer);
      if (response.status < 500 || attempt === retries) return response;
      response.body?.cancel().catch(() => {});
      lastError = new Error(`Plex HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (signal?.aborted || !retryIf(error)) throw error;
    }
    if (attempt < retries) await sleep(400 * (attempt + 1));
  }
  throw lastError;
}

// Transcodeur iGPU (uniquement sur la passerelle installée à côté des fichiers, ex. LXC sur pve)
const CACHE_DIR = process.env.NOMAD_CACHE_DIR || path.join(__dirname, ".cache");
const transcoder = process.env.NOMAD_TRANSCODER === "vaapi"
  ? createTranscoder({
      device: process.env.VAAPI_DEVICE || "/dev/dri/renderD128",
      driver: process.env.LIBVA_DRIVER_NAME || "iHD",
      cacheDir: CACHE_DIR,
      // "cheminPlex=cheminLocal" séparés par des virgules (identiques par défaut)
      mediaMap: (process.env.NOMAD_MEDIA_MAP || "").split(",").filter(Boolean).map((m) => m.split("=")),
    })
  : null;
const offline = transcoder?.available ? createOffline({ transcoder, cacheDir: CACHE_DIR }) : null;

// Cache disque pour les miniatures générées (avec les autres caches, hors du dossier de l'appli)
const IMAGE_CACHE_DIR = process.env.NOMAD_IMAGE_CACHE_DIR || path.join(CACHE_DIR, "images");
// Plafonné (500 Mo par défaut ≈ 25 000 vignettes) : les moins récemment servies partent en premier
const imageCache = createImageCache({
  dir: IMAGE_CACHE_DIR,
  maxBytes: (Number(process.env.NOMAD_IMAGE_CACHE_MB) || 500) * 1024 ** 2,
});
// Images qui ont fait planter le transcodeur photo de Plex (hors du dossier des vignettes, que
// le ménage du cache vide) et nombre de transcodages photo simultanés
const imageGuard = createImageGuard({
  file: path.join(CACHE_DIR, "plex-crash-images.json"),
  concurrency: Number(process.env.NOMAD_IMAGE_CONCURRENCY) || 4,
  // Plex répond-il encore ? N'importe quelle réponse HTTP suffit
  isPlexUp: () =>
    fetchPlex(plexUrl("/identity"), { timeoutMs: 3000 }).then(
      (r) => {
        r.body?.cancel().catch(() => {});
        return true;
      },
      () => false,
    ),
});

// Image brute en JPEG niveaux de gris ? Seuls ses premiers Ko sont lus (en-tête du fichier ;
// les métadonnées EXIF peuvent repousser l'en-tête de trame au-delà de 64 Ko)
async function isGrayscaleJpeg(imagePath) {
  try {
    const upstream = await fetchPlex(plexUrl(imagePath), {
      headers: { Range: "bytes=0-262143" },
      timeoutMs: PLEX_TIMEOUT_MS,
      retries: 1,
    });
    if (!upstream.ok || !upstream.body) {
      upstream.body?.cancel().catch(() => {});
      return false;
    }
    return jpegComponents(await readHead(upstream.body, 256 * 1024)) === 1;
  } catch {
    return false; // Plex injoignable : le transcodage échouera de lui-même
  }
}

// -------------------------------------------------------------
// IN-MEMORY CACHE ACCELERATOR (TTL)
// -------------------------------------------------------------
const memoryCache = new Map();
function cacheGet(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return item.data;
}

function cacheSet(key, data, ttlSeconds) {
  if (memoryCache.size > 500) {
    const firstKey = memoryCache.keys().next().value;
    memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// Compression HTTP (Gzip/Brotli) pour tous les assets et JSON
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    // Ne pas compresser les flux vidéo ou audio (déjà compressés)
    if (req.path.startsWith("/api/stream/")) return false;
    return compression.filter(req, res);
  }
}));

app.use(cors());
app.use(express.json());

// Authentification par code d'accès partagé (opt-in : active seulement si ACCESS_CODE est défini).
// trust proxy : lire x-forwarded-proto derrière `tailscale serve` pour poser un cookie Secure en HTTPS.
app.set("trust proxy", true);
const auth = createAuth({ accessCode: process.env.ACCESS_CODE, secret: process.env.SESSION_SECRET });
app.use(auth.middleware);
app.post("/api/auth", auth.handleLogin);
app.post("/api/auth/logout", auth.handleLogout);
app.get("/api/auth/check", auth.handleCheck);
if (auth.enabled) console.log("🔒 Code d'accès actif (auth par cookie)");

// Helper: appel JSON vers Plex (métadonnées), avec délai maximal global et une nouvelle tentative
// (micro-coupure Tailscale, erreur 5xx). Sans délai, un Plex figé bloquait la requête indéfiniment.
async function plexFetch(endpoint) {
  const response = await fetchPlex(plexUrl(endpoint), {
    headers: { Accept: "application/json" },
    timeoutMs: PLEX_TIMEOUT_MS,
    retries: 1,
    signal: AbortSignal.timeout(PLEX_TIMEOUT_MS * 2),
  });
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    throw new Error(`Plex API Error [${response.status}] on ${endpoint.split("?")[0]}`);
  }
  return response.json();
}

// Helper: Formatter un item média Plex en structure propre avec dimensions d'images ciblées
function formatMediaItem(item) {
  if (!item) return null;
  
  const media = item.Media?.[0];
  const part = media?.Part?.[0];
  
  const duration = item.duration || 0;
  const viewOffset = item.viewOffset || 0;
  const progressPercent = duration > 0 ? Math.min(100, Math.round((viewOffset / duration) * 100)) : 0;

  const isAudio = item.type === "track" || item.type === "album" || item.type === "artist";
  const isEpisode = item.type === "episode";
  const thumbDim = isAudio ? "width=300&height=300" : isEpisode ? "width=480&height=270" : "width=300&height=450";

  return {
    id: item.ratingKey,
    key: item.key,
    type: item.type, // movie, episode, track, show, album, artist
    title: item.title,
    originalTitle: item.originalTitle,
    parentTitle: item.parentTitle, // ex: nom de série ou d'album
    grandparentTitle: item.grandparentTitle, // ex: nom de série pour un épisode
    seasonNumber: item.parentIndex,
    episodeNumber: item.index,
    summary: item.summary || "",
    year: item.year,
    duration: duration,
    durationMinutes: Math.round(duration / 60000),
    viewOffset: viewOffset,
    progressPercent: progressPercent,
    rating: item.audienceRating || item.rating || null,
    contentRating: item.contentRating,
    studio: item.studio,
    tagline: item.tagline,
    addedAt: item.addedAt,
    thumb: item.thumb ? `/api/image?path=${encodeURIComponent(item.thumb)}&${thumbDim}` : null,
    art: item.art ? `/api/image?path=${encodeURIComponent(item.art)}&width=960&height=540` : null,
    parentThumb: item.parentThumb ? `/api/image?path=${encodeURIComponent(item.parentThumb)}&${thumbDim}` : null,
    grandparentThumb: item.grandparentThumb ? `/api/image?path=${encodeURIComponent(item.grandparentThumb)}&${thumbDim}` : null,
    genres: (item.Genre || []).map((g) => g.tag),
    directors: (item.Director || []).map((d) => d.tag),
    roles: (item.Role || []).slice(0, 8).map((r) => r.tag),
    partKey: part?.key || null,
    partId: part?.id ? String(part.id) : null,
    bitrate: media?.bitrate || null, // kb/s, sert au choix automatique de la qualité
    container: media?.container || null,
    videoCodec: media?.videoCodec || null,
    audioCodec: media?.audioCodec || null,
    videoResolution: media?.videoResolution || null,
  };
}

// -------------------------------------------------------------
// ROUTES API
// -------------------------------------------------------------

// 1. Statut & Infos du serveur (Cache 15s)
app.get("/api/status", async (req, res) => {
  const cached = cacheGet("api_status");
  if (cached) return res.json(cached);

  try {
    const data = await plexFetch("/");
    const serverName = data.MediaContainer?.friendlyName || "Plex Nomad Server";
    const result = {
      status: "online",
      serverName,
      plexUrl: PLEX_URL,
      version: data.MediaContainer?.version,
    };
    cacheSet("api_status", result, 15);
    res.json(result);
  } catch (error) {
    res.status(502).json({ status: "error", message: error.message });
  }
});

// 2. Hubs d'accueil (Cache 30s)
app.get("/api/hubs", async (req, res) => {
  const cached = cacheGet("api_hubs");
  if (cached) return res.json(cached);

  try {
    const [onDeckRes, moviesRes, showsRes, musicRes] = await Promise.allSettled([
      plexFetch("/library/onDeck"),
      plexFetch("/library/sections/1/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=12"),
      // recentlyAdded renvoie des épisodes pour une bibliothèque de séries : on demande les séries
      // elles-mêmes, triées par date d'ajout de leur dernier épisode
      plexFetch("/library/sections/2/all?type=2&sort=episode.addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=12"),
      plexFetch("/library/sections/5/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=12"),
    ]);

    const onDeck = onDeckRes.status === "fulfilled"
      ? (onDeckRes.value.MediaContainer?.Metadata || []).map(formatMediaItem)
      : [];

    const recentMovies = moviesRes.status === "fulfilled"
      ? (moviesRes.value.MediaContainer?.Metadata || []).map(formatMediaItem)
      : [];

    const recentShows = showsRes.status === "fulfilled"
      ? (showsRes.value.MediaContainer?.Metadata || []).slice(0, 12).map(formatMediaItem)
      : [];

    const recentMusic = musicRes.status === "fulfilled"
      ? (musicRes.value.MediaContainer?.Metadata || []).map(formatMediaItem)
      : [];

    const result = {
      onDeck,
      recentMovies,
      recentShows,
      recentMusic,
    };
    cacheSet("api_hubs", result, 30);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Films (Bibliothèque 1) (Cache 60s)
app.get("/api/movies", async (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  const limit = parseInt(req.query.limit) || 30;
  const sort = req.query.sort || "titleSort:asc";
  const cacheKey = `movies_${offset}_${limit}_${sort}`;

  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await plexFetch(`/library/sections/1/all?sort=${encodeURIComponent(sort)}&X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${limit}`);
    const totalSize = data.MediaContainer?.totalSize || 0;
    const items = (data.MediaContainer?.Metadata || []).map(formatMediaItem);

    const result = {
      items,
      offset,
      limit,
      totalSize,
    };
    cacheSet(cacheKey, result, 60);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Séries (Bibliothèque 2) (Cache 60s)
app.get("/api/shows", async (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  const limit = parseInt(req.query.limit) || 30;
  const sort = req.query.sort || "titleSort:asc";
  const cacheKey = `shows_${offset}_${limit}_${sort}`;

  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await plexFetch(`/library/sections/2/all?sort=${encodeURIComponent(sort)}&X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${limit}`);
    const totalSize = data.MediaContainer?.totalSize || 0;
    const items = (data.MediaContainer?.Metadata || []).map(formatMediaItem);

    const result = {
      items,
      offset,
      limit,
      totalSize,
    };
    cacheSet(cacheKey, result, 60);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Détail d'une Série avec ses Saisons et Épisodes (Cache 120s)
app.get("/api/shows/:id", async (req, res) => {
  const showId = req.params.id;
  if (!isNumericId(showId)) return res.status(400).json({ error: "id invalide" });
  const cacheKey = `show_detail_${showId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [showData, seasonsData, episodesData] = await Promise.all([
      plexFetch(`/library/metadata/${showId}`),
      plexFetch(`/library/metadata/${showId}/children`),
      plexFetch(`/library/metadata/${showId}/allLeaves`),
    ]);

    const show = formatMediaItem(showData.MediaContainer?.Metadata?.[0]);
    const seasons = (seasonsData.MediaContainer?.Metadata || []).map((s) => ({
      id: s.ratingKey,
      key: s.key,
      title: s.title,
      seasonNumber: s.index,
      episodeCount: s.leafCount,
      thumb: s.thumb ? `/api/image?path=${encodeURIComponent(s.thumb)}&width=300&height=450` : show.thumb,
    }));
    const episodes = (episodesData.MediaContainer?.Metadata || []).map(formatMediaItem);

    const result = {
      show,
      seasons,
      episodes,
    };
    cacheSet(cacheKey, result, 120);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Musique (Artistes - Bibliothèque 5) (Cache 120s)
app.get("/api/music/artists", async (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  const limit = parseInt(req.query.limit) || 40;
  const sort = req.query.sort || "titleSort:asc";
  const cacheKey = `music_artists_${offset}_${limit}_${sort}`;

  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await plexFetch(`/library/sections/5/all?sort=${encodeURIComponent(sort)}&X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${limit}`);
    const totalSize = data.MediaContainer?.totalSize || 0;
    const items = (data.MediaContainer?.Metadata || []).map(formatMediaItem);

    const result = {
      items,
      offset,
      limit,
      totalSize,
    };
    cacheSet(cacheKey, result, 120);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Détail d'un Artiste avec ses Albums (Cache 120s)
app.get("/api/music/artists/:id", async (req, res) => {
  const artistId = req.params.id;
  if (!isNumericId(artistId)) return res.status(400).json({ error: "id invalide" });
  const cacheKey = `artist_detail_${artistId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [artistData, albumsData] = await Promise.all([
      plexFetch(`/library/metadata/${artistId}`),
      plexFetch(`/library/metadata/${artistId}/children`),
    ]);

    const artist = formatMediaItem(artistData.MediaContainer?.Metadata?.[0]);
    const albums = (albumsData.MediaContainer?.Metadata || []).map(formatMediaItem);

    const result = {
      artist,
      albums,
    };
    cacheSet(cacheKey, result, 120);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Détail d'un Album avec ses Pistes (Cache 120s)
app.get("/api/music/albums/:id", async (req, res) => {
  const albumId = req.params.id;
  if (!isNumericId(albumId)) return res.status(400).json({ error: "id invalide" });
  const cacheKey = `album_detail_${albumId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [albumData, tracksData] = await Promise.all([
      plexFetch(`/library/metadata/${albumId}`),
      plexFetch(`/library/metadata/${albumId}/children`),
    ]);

    const album = formatMediaItem(albumData.MediaContainer?.Metadata?.[0]);
    const tracks = (tracksData.MediaContainer?.Metadata || []).map((t) => {
      const f = formatMediaItem(t);
      return {
        ...f,
        trackNumber: t.index,
        streamUrl: `/api/stream/audio?key=${encodeURIComponent(f.partKey)}`,
      };
    });

    const result = {
      album,
      tracks,
    };
    cacheSet(cacheKey, result, 120);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Recherche globale
app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || q.trim().length === 0) {
      return res.json({ movies: [], shows: [], tracks: [], artists: [] });
    }

    const data = await plexFetch(`/hubs/search?query=${encodeURIComponent(q)}&limit=15`);
    const hubs = data.MediaContainer?.Hub || [];

    const result = {
      movies: [],
      shows: [],
      tracks: [],
      artists: [],
    };

    for (const h of hubs) {
      const items = (h.Metadata || []).map(formatMediaItem);
      if (h.type === "movie") result.movies.push(...items);
      else if (h.type === "show") result.shows.push(...items);
      else if (h.type === "track") {
        result.tracks.push(
          ...items.map((t) => ({
            ...t,
            streamUrl: `/api/stream/audio?key=${encodeURIComponent(t.partKey)}`,
          }))
        );
      } else if (h.type === "artist") result.artists.push(...items);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Détail complet d'un média (Streams audio, sous-titres, etc.) (Cache 300s)
app.get("/api/metadata/:id", async (req, res) => {
  const id = req.params.id;
  if (!isNumericId(id)) return res.status(400).json({ error: "id invalide" });
  const cacheKey = `metadata_${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await plexFetch(`/library/metadata/${id}`);
    const item = data.MediaContainer?.Metadata?.[0];
    if (!item) return res.status(404).json({ error: "Item not found" });

    const formatted = formatMediaItem(item);
    const media = item.Media?.[0];
    const part = media?.Part?.[0];

    // Extraire les flux audio et sous-titres
    const streams = part?.Stream || [];
    const audioStreams = streams
      .filter((s) => s.streamType === 2)
      .map((s) => ({
        id: s.id,
        index: s.index,
        language: s.language || "Inconnu",
        languageCode: s.languageCode || "und",
        title: s.displayTitle || s.extendedDisplayTitle || s.language || "Audio",
        codec: s.codec,
        channels: s.channels,
        selected: s.selected === true || s.selected === 1,
      }));

    const subtitleStreams = streams
      .filter((s) => s.streamType === 3)
      .map((s) => ({
        id: s.id,
        index: s.index,
        language: s.language || "Inconnu",
        languageCode: s.languageCode || "und",
        title: s.displayTitle || s.extendedDisplayTitle || s.language || "Sous-titres",
        codec: s.codec,
        selected: s.selected === true || s.selected === 1,
        forced: s.forced === true || s.forced === 1,
      }));

    // URL de flux direct (MP4/MKV) ou HLS
    const directStreamUrl = `/api/stream/file?key=${encodeURIComponent(part?.key)}`;
    const hlsStreamUrl = `/api/stream/hls/start.m3u8?id=${id}`;

    const result = {
      ...formatted,
      audioStreams,
      subtitleStreams,
      directStreamUrl,
      hlsStreamUrl,
    };
    cacheSet(cacheKey, result, 300);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11. Reporting Timeline (Scrobble / Reprise de lecture synchronisée avec Plex)
app.post("/api/timeline", async (req, res) => {
  try {
    const { ratingKey, key, state, time, duration, client } = req.body;
    if (!isNumericId(String(ratingKey))) return res.status(400).json({ error: "ratingKey invalide" });
    // state: 'playing', 'paused', 'stopped'
    const url = plexUrl("/:/timeline", {
      ratingKey: String(ratingKey),
      key: key || `/library/metadata/${ratingKey}`,
      state: state || "playing",
      time: String(Math.round(time || 0)),
      duration: String(Math.round(duration || 0)),
      ...PLEX_WEB_PROFILE,
    }, plexClientId(client));
    await fetchPlex(url, { timeoutMs: 10000, retries: 1 });
    // Invalider les caches qui contiennent la position de reprise (sinon "Reprendre" repart d'un point ancien)
    memoryCache.delete("api_hubs");
    memoryCache.delete(`metadata_${ratingKey}`);
    for (const k of memoryCache.keys()) {
      if (k.startsWith("show_detail_")) memoryCache.delete(k);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// En-têtes de Plex relayés tels quels au navigateur
const FORWARDED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
];

// Helper: Proxy de flux (fichier, audio, segments HLS) avec Range HTTP et contre-pression.
// - si le navigateur ferme la connexion, la lecture côté Plex est annulée (pas de bande passante gâchée) ;
// - si Plex cesse d'envoyer des données alors que le navigateur en attend, la réponse est coupée
//   au bout de `idleMs` pour que le lecteur relance la requête au lieu de rester figé.
async function proxyStream(req, res, targetUrl, { timeoutMs = 20000, retries = 1, idleMs = 30000, cacheControl } = {}) {
  const clientGone = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) clientGone.abort(new Error("Client déconnecté"));
  });

  let upstream;
  try {
    // Demander un corps non compressé : fetch décompresse le gzip de Plex de façon transparente,
    // et le Content-Length relayé (taille compressée) tronquerait alors la réponse — c'est ce qui
    // coupait les playlists HLS à ~10 % de leur longueur (lecture arrêtée au bout de ~10 min)
    const headers = { "accept-encoding": "identity" };
    if (req.headers.range) headers.range = req.headers.range;
    upstream = await fetchPlex(targetUrl, { headers, timeoutMs, retries, signal: clientGone.signal });
  } catch (error) {
    if (!res.headersSent && !clientGone.signal.aborted) {
      res.status(504).json({ error: error.message });
    }
    return;
  }

  res.status(upstream.status);
  const decompressed = !!upstream.headers.get("content-encoding");
  for (const h of FORWARDED_HEADERS) {
    if (decompressed && h === "content-length") continue;
    const val = upstream.headers.get(h);
    if (val) res.setHeader(h, val);
  }
  res.setHeader("Accept-Ranges", "bytes");
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);

  if (!upstream.body) return res.end();

  let lastChunkAt = Date.now();
  const meter = new Transform({
    transform(chunk, _enc, callback) {
      lastChunkAt = Date.now();
      callback(null, chunk);
    },
  });
  const watchdog = setInterval(() => {
    // Si le navigateur ne lit plus (tampon plein, pause), ce n'est pas un blocage de Plex
    if (Date.now() - lastChunkAt > idleMs && !res.writableNeedDrain) {
      meter.destroy(new Error("Plex ne transmet plus de données"));
    }
  }, 5000);

  try {
    await pipeline(Readable.fromWeb(upstream.body), meter, res);
  } catch {
    // Navigateur parti ou flux interrompu : pipeline a déjà détruit les deux côtés,
    // le navigateur (ou hls.js) relancera la requête si besoin.
  } finally {
    clearInterval(watchdog);
  }
}

// 12. Streaming direct fichier vidéo (MP4 Direct Play avec support Range HTTP)
app.get("/api/stream/file", (req, res) => {
  const partKey = req.query.key;
  if (!isPartKey(partKey)) return res.status(400).send("Clé de fichier invalide");
  proxyStream(req, res, plexUrl(partKey));
});

// 13. Streaming Audio direct (Musique, CarPlay, écran de verrouillage)
app.get("/api/stream/audio", (req, res) => {
  const partKey = req.query.key;
  if (!isPartKey(partKey)) return res.status(400).send("Clé de fichier invalide");
  proxyStream(req, res, plexUrl(partKey));
});

// Sessions de transcodage HLS : session -> identifiant Plex de l'appareil qui l'a ouverte
// (les segments, le ping et l'arrêt doivent être demandés avec le même identifiant)
const hlsSessions = new Map();

function touchSession(session, clientId) {
  const now = Date.now();
  const existing = hlsSessions.get(session);
  hlsSessions.set(session, { clientId: clientId || existing?.clientId || CLIENT_ID, at: now });
  if (hlsSessions.size > 100) {
    for (const [key, value] of hlsSessions) {
      if (now - value.at > 6 * 3600 * 1000) hlsSessions.delete(key);
    }
  }
}

const sessionClientId = (session) => hlsSessions.get(session)?.clientId || CLIENT_ID;

// 14. Démarrage d'une session HLS (remux ou transcodage) au bon palier de qualité et au bon instant
app.get("/api/stream/hls/start.m3u8", async (req, res) => {
  const { id, session, partId, audioStreamID, subtitleStreamID } = req.query;
  if (!isNumericId(id) || !isSessionId(session)) return res.status(400).send("Paramètres invalides");
  const quality = Object.hasOwn(QUALITY_PRESETS, req.query.quality) ? req.query.quality : "original";
  const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
  const clientId = plexClientId(req.query.client);
  const timings = [];
  const t0 = Date.now();

  try {
    // 1. Pistes audio / sous-titres : Plex ne lit pas ces paramètres dans l'URL de transcodage,
    //    il faut enregistrer le choix sur le fichier (comme le font les applications Plex)
    if (isNumericId(partId) && (isNumericId(audioStreamID) || isNumericId(subtitleStreamID))) {
      const selection = { allParts: "1" };
      if (isNumericId(audioStreamID)) selection.audioStreamID = audioStreamID;
      if (isNumericId(subtitleStreamID)) selection.subtitleStreamID = subtitleStreamID; // "0" = désactivés
      const put = await fetchPlex(plexUrl(`/library/parts/${partId}`, selection, clientId), { method: "PUT", retries: 1 });
      put.body?.cancel().catch(() => {});
      if (!put.ok) return res.status(502).send("Plex a refusé le changement de piste");
      timings.push(`pistes;dur=${Date.now() - t0}`);
    }

    const params = {
      path: `/library/metadata/${id}`,
      mediaIndex: "0",
      partIndex: "0",
      protocol: "hls",
      directPlay: "0",
      directStream: "1",
      fastSeek: "1",
      subtitles: "burn", // HLS/MPEG-TS ne transporte pas les sous-titres : ils sont incrustés si activés
      session,
      ...PLEX_WEB_PROFILE,
      ...QUALITY_PRESETS[quality],
    };
    // Démarrer le transcodeur directement au point de reprise (sinon il part de 0 puis doit tout relancer)
    if (offset > 0) params.offset = String(offset);

    // 2. Décision puis démarrage, dans l'ordre utilisé par Plex Web : sans la décision, Plex
    //    réutilise parfois l'ancienne qualité de l'appareil, voire refuse le démarrage (HTTP 400)
    const decision = await fetchPlex(plexUrl("/video/:/transcode/universal/decision", params, clientId), { retries: 1 });
    decision.body?.cancel().catch(() => {});
    if (!decision.ok) return res.status(decision.status).send("Plex refuse ce média");
    timings.push(`decision;dur=${Date.now() - t0}`);

    const upstream = await fetchPlex(plexUrl("/video/:/transcode/universal/start.m3u8", params, clientId), { retries: 1 });
    if (!upstream.ok) {
      upstream.body?.cancel().catch(() => {});
      return res.status(upstream.status).send("Plex transcode start failed");
    }
    const m3u8Text = await upstream.text();
    timings.push(`start;dur=${Date.now() - t0}`);
    touchSession(session, clientId);

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Server-Timing", timings.join(", "));
    res.send(m3u8Text);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message });
  }
});

// 15. Proxy des segments vidéo et sous-playlists HLS
app.get("/api/stream/hls/session/:session/*", (req, res) => {
  const session = req.params.session;
  if (!isSessionId(session)) return res.status(400).send("Session invalide");
  const subpath = req.params[0];
  if (!isHlsSubpath(subpath)) return res.status(400).send("Chemin invalide");
  touchSession(session);
  const isPlaylist = subpath.endsWith(".m3u8");
  const targetUrl = plexUrl(
    `/video/:/transcode/universal/session/${encodeURIComponent(session)}/${subpath}`,
    {},
    sessionClientId(session)
  );
  // Un segment peut attendre que le transcodeur redémarre (saut dans la lecture) : délai plus long
  proxyStream(req, res, targetUrl, {
    timeoutMs: isPlaylist ? 20000 : 45000,
    retries: isPlaylist ? 2 : 1,
    cacheControl: isPlaylist ? "no-cache, no-store, must-revalidate" : "private, max-age=3600",
  });
});

// 16. Maintien en vie d'une session (lecture en pause : le navigateur ne demande plus de segments)
app.get("/api/stream/hls/ping", async (req, res) => {
  const session = req.query.session;
  if (!isSessionId(session)) return res.status(400).send("Session invalide");
  try {
    touchSession(session);
    const r = await fetchPlex(plexUrl("/video/:/transcode/universal/ping", { session }, sessionClientId(session)), { timeoutMs: 10000 });
    r.body?.cancel().catch(() => {});
    res.status(r.ok ? 200 : 410).json({ alive: r.ok });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// 17. Arrêt d'une session de transcode HLS (GET, ou POST via navigator.sendBeacon à la fermeture de page)
async function stopHlsSession(req, res) {
  const session = req.query.session;
  if (!isSessionId(session)) return res.status(400).send("Missing session");
  try {
    const r = await fetchPlex(plexUrl("/video/:/transcode/universal/stop", { session }, sessionClientId(session)), { timeoutMs: 10000 });
    r.body?.cancel().catch(() => {});
    hlsSessions.delete(session);
    res.json({ success: true });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}
app.get("/api/stream/hls/stop", stopHlsSession);
app.post("/api/stream/hls/stop", stopHlsSession);

// 18. Proxy & Cache Haute Performance d'Images (WebP + Cache Disque + ETag)
app.get("/api/image", async (req, res) => {
  const imagePath = req.query.path;
  const format = req.query.format || "webp";
  if (!isPlexImagePath(imagePath) || !Object.hasOwn(IMAGE_FORMATS, format)) {
    return res.status(400).send("Image invalide");
  }
  const width = clampInt(req.query.width, 300, 16, 2000);
  const height = clampInt(req.query.height, 450, 16, 2000);

  const cacheKey = crypto.createHash("md5").update(`${imagePath}_${width}_${height}_${format}`).digest("hex");
  const cachedFilePath = path.join(IMAGE_CACHE_DIR, `${cacheKey}.${format}`);
  const etag = `"${cacheKey}"`;

  // Validation du cache HTTP navigateur
  if (req.headers["if-none-match"] === etag) return res.status(304).end();

  // 1. Image déjà présente sur disque
  if (fs.existsSync(cachedFilePath)) {
    imageCache.touch(cachedFilePath);
    res.setHeader("Content-Type", IMAGE_FORMATS[format]);
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable"); // Cache 30 jours
    res.setHeader("ETag", etag);
    return fs.createReadStream(cachedFilePath).pipe(res);
  }

  const get = (url, options) =>
    fetchPlex(url, { timeoutMs: PLEX_TIMEOUT_MS, retries: 1, signal: AbortSignal.timeout(PLEX_TIMEOUT_MS * 2), ...options });
  const read = async (upstream) => ({
    buffer: Buffer.from(await upstream.arrayBuffer()),
    type: upstream.headers.get("content-type"),
  });
  try {
    // 2. Transcodage ultra-léger via le photo transcoder de Plex, sauf si l'image l'a déjà fait planter
    let image = null;
    let cacheControl = "public, max-age=2592000, immutable"; // Cache 30 jours
    // Les JPEG en niveaux de gris font planter le transcodeur : reconnus avant de le solliciter
    if (!imageGuard.isSuspect(imagePath) && (await isGrayscaleJpeg(imagePath))) {
      imageGuard.setAside(imagePath, "JPEG en niveaux de gris");
    }
    if (!imageGuard.isSuspect(imagePath)) {
      const innerUrl = `${imagePath}?X-Plex-Token=${PLEX_TOKEN}`;
      const transcodeUrl = plexUrl("/photo/:/transcode", { width, height, minSize: "1", upscale: "1", format, url: innerUrl });
      image = await imageGuard.transcode(imagePath, async () => {
        // Jamais de nouvelle tentative après une coupure : si Plex vient de tomber sur cette
        // image, la lui redemander le referait planter
        const upstream = await get(transcodeUrl, { retryIf: (err) => !isConnectionDrop(err) });
        if (upstream.ok) return read(upstream);
        upstream.body?.cancel().catch(() => {});
        return null;
      });
    }
    if (!image) {
      // Repli sur l'image brute si le photo transcoder échoue (ou a planté sur cette image)
      const upstream = await get(plexUrl(imagePath));
      if (!upstream.ok) {
        upstream.body?.cancel().catch(() => {});
        return res.status(upstream.status === 404 ? 404 : 502).send("Image introuvable");
      }
      image = await read(upstream);
      cacheControl = "public, max-age=604800";
    }
    const { buffer } = image;
    // Sauvegarde sur disque asynchrone
    fs.promises
      .writeFile(cachedFilePath, buffer)
      .then(() => imageCache.noteWrite())
      .catch((err) => console.error("Cache file write error:", err));
    res.setHeader("Content-Type", image.type || IMAGE_FORMATS[format]);
    res.setHeader("Cache-Control", cacheControl);
    res.setHeader("ETag", etag);
    res.send(buffer);
  } catch {
    if (!res.headersSent) res.status(502).send("Image indisponible");
  }
});


// 19. Transcodeur iGPU multi-débits (HLS ABR)
const isJobId = (v) => typeof v === "string" && /^[a-f0-9]{16}$/.test(v);

app.get("/api/tx/available", (req, res) => {
  res.json({
    available: !!transcoder?.available,
    offline: !!offline,
    reason: transcoder ? transcoder.unavailableReason : "désactivé",
  });
});

app.post("/api/tx/start", async (req, res) => {
  if (!transcoder?.available) return res.status(503).json({ error: "Transcodeur indisponible" });
  const { id, audioIndex, start } = req.body || {};
  if (!isNumericId(String(id))) return res.status(400).json({ error: "id invalide" });
  try {
    const data = await plexFetch(`/library/metadata/${id}`);
    const item = data.MediaContainer?.Metadata?.[0];
    const part = item?.Media?.[0]?.Part?.[0];
    if (!part?.file) return res.status(404).json({ error: "Fichier introuvable" });
    const job = await transcoder.createJob({
      plexFile: part.file,
      audioIndex: Number.isInteger(audioIndex) ? audioIndex : undefined,
      startSeconds: Math.max(0, Number(start) || 0),
      durationHintMs: item.duration,
    });
    res.json({
      job: job.id,
      master: `/api/tx/${job.id}/master.m3u8`,
      segment: 4,
      hwDecode: job.hwDecode,
      variants: job.variants.map((v, i) => ({ index: i, id: v.id, width: v.width, height: v.height, kbps: v.kbps })),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get("/api/tx/:job/master.m3u8", (req, res) => {
  const job = isJobId(req.params.job) && transcoder?.getJob(req.params.job);
  if (!job) return res.status(404).send("Session inconnue");
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Cache-Control", "no-store");
  res.send(transcoder.masterPlaylist(job, Number(req.query.first) || 0));
});

app.get("/api/tx/:job/v:variant/index.m3u8", (req, res) => {
  const job = isJobId(req.params.job) && transcoder?.getJob(req.params.job);
  if (!job) return res.status(404).send("Session inconnue");
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Cache-Control", "no-store");
  res.send(transcoder.variantPlaylist(job));
});

app.get("/api/tx/:job/v:variant/:n.ts", async (req, res) => {
  const job = isJobId(req.params.job) && transcoder?.getJob(req.params.job);
  if (!job) return res.status(404).send("Session inconnue");
  const variant = Number(req.params.variant);
  const n = Number(req.params.n);
  if (!Number.isInteger(variant) || !Number.isInteger(n)) return res.status(404).send("Segment inexistant");
  try {
    const file = await transcoder.segment(job, variant, n);
    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(file);
  } catch (error) {
    if (!res.headersSent) res.status(error.status || 500).send(error.message);
  }
});

const stopTxJob = (req, res) => {
  if (isJobId(req.params.job)) transcoder?.stopJob(req.params.job);
  res.json({ success: true });
};
app.get("/api/tx/:job/stop", stopTxJob);
app.post("/api/tx/:job/stop", stopTxJob);

app.get("/api/tx/status", (req, res) => res.json(transcoder ? transcoder.status() : []));


// 20. Versions hors connexion (MP4 compacts préparés par l'iGPU, téléchargés par l'appli)
app.post("/api/offline/prepare", async (req, res) => {
  if (!offline) return res.status(503).json({ error: "Mode hors connexion indisponible sur cette passerelle" });
  const { id, audioIndex, quality } = req.body || {};
  if (!isNumericId(String(id))) return res.status(400).json({ error: "id invalide" });
  try {
    const data = await plexFetch(`/library/metadata/${id}`);
    const item = data.MediaContainer?.Metadata?.[0];
    const part = item?.Media?.[0]?.Part?.[0];
    if (!part?.file) return res.status(404).json({ error: "Fichier introuvable" });
    res.json(await offline.prepare({
      id: String(id),
      plexFile: part.file,
      audioIndex: Number.isInteger(audioIndex) ? audioIndex : undefined,
      quality,
      durationHintMs: item.duration,
    }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get("/api/offline/status/:key", (req, res) => {
  const status = offline?.status(req.params.key);
  if (!status) return res.status(404).json({ error: "Inconnu" });
  res.json(status);
});

app.get("/api/offline/file/:key.mp4", (req, res) => {
  const file = offline?.readyFile(req.params.key);
  if (!file) return res.status(404).send("Pas encore prêt");
  res.sendFile(file, { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" } });
});


// 21. Observabilité de la lecture : état du transcodeur pour le panneau de statistiques du lecteur,
//     et journal d'une ligne JSON par lecture (NOMAD_CACHE_DIR/logs/playback.jsonl)
const playbackLog = createPlaybackLog({ dir: process.env.NOMAD_LOG_DIR || path.join(CACHE_DIR, "logs") });

app.get("/api/playback/stats", async (req, res) => {
  const { session, job } = req.query;
  // Flux iGPU : avance de la conversion sur la lecture (proche de 0 et non en pause = elle ne suit pas)
  if (isJobId(job)) {
    const j = transcoder?.getJob(job);
    if (!j) return res.json({ transcoder: null });
    return res.json({
      transcoder: {
        kind: "igpu",
        aheadSeconds: Math.max(0, (j.produced - j.lastRequest) * SEG),
        paused: !!j.paused,
        running: !!j.proc,
        hwDecode: !!j.hwDecode,
      },
    });
  }
  // Flux Plex : vitesse de conversion (× temps réel) et ralentissement volontaire (throttled)
  if (isSessionId(session)) {
    try {
      const data = await plexFetch("/transcode/sessions");
      const s = (data.MediaContainer?.TranscodeSession || []).find((t) => String(t.key || "").endsWith(`/${session}`));
      if (!s) return res.json({ transcoder: null });
      return res.json({
        transcoder: {
          kind: "plex",
          speed: typeof s.speed === "number" ? s.speed : null,
          throttled: !!s.throttled,
          videoDecision: s.videoDecision ?? null,
          hw: !!(s.transcodeHwFullPipeline || s.transcodeHwEncoding),
        },
      });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }
  res.status(400).json({ error: "session ou job requis" });
});

app.post("/api/playback/log", (req, res) => {
  const entry = sanitizePlayback(req.body);
  if (!entry) return res.status(400).json({ error: "Entrée invalide" });
  const client = typeof req.body.client === "string" && /^[A-Za-z0-9-]{8,64}$/.test(req.body.client) ? req.body.client : null;
  const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 200) : null;
  playbackLog.append({ at: new Date().toISOString(), client, ua, ...entry });
  console.log(summarizePlayback(entry));
  res.status(204).end();
});

// -------------------------------------------------------------
// SERVEUR STATIC PWA (Client React / Vite) AVEC CACHE IMMUABLE
// -------------------------------------------------------------
const clientDist = path.join(__dirname, "../client/dist");

// Assets fingerprintés (JS, CSS) avec cache 1 an immuable
app.use("/assets", express.static(path.join(clientDist, "assets"), {
  maxAge: "1y",
  immutable: true,
}));

// Fichiers PWA racine (manifest, sw, icons) avec cache modéré
app.use(express.static(clientDist, {
  maxAge: "1h",
}));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found" });
  }
  const indexPath = path.join(clientDist, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.send(`
        <!DOCTYPE html>
        <html>
          <head><title>Nomad Stream</title></head>
          <body style="background:#0f172a;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
            <h1>Nomad Stream API Gateway Active</h1>
            <p>Le frontend PWA est en cours d'initialisation...</p>
            <p><a href="/api/status" style="color:#38bdf8;">Voir l'état de l'API Plex</a></p>
          </body>
        </html>
      `);
    }
  });
});

// HOST=127.0.0.1 : accessible uniquement via `tailscale serve` (HTTPS, tailnet seulement)
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`⚡ Nomad Stream Server démarré sur http://${HOST}:${PORT}`);
  console.log(`🔗 Relié à Plex : ${PLEX_URL}`);
  console.log(`🚀 Compression HTTP & Cache WebP actif`);
});
