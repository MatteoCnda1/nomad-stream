// Passerelle Nomad Stream : configuration, middlewares, montage des routes (routes/*.js) et
// service du client PWA compilé.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import compression from "compression";
import { createTranscoder } from "./transcoder.js";
import { createOffline } from "./offline.js";
import { createAuth } from "./auth.js";
import { createPlex } from "./plex.js";
import { createMemoryCache } from "./memory-cache.js";
import { catalogRoutes } from "./routes/catalog.js";
import { streamRoutes } from "./routes/stream.js";
import { imageRoutes } from "./routes/images.js";
import { transcodeRoutes } from "./routes/transcode.js";
import { playbackRoutes } from "./routes/playback.js";
import { searchRoutes } from "./routes/search.js";
import { radioRoutes } from "./routes/radio.js";
import { genreRoutes } from "./routes/genres.js";
import { createLibrarySearch } from "./search.js";
import { createMusicGenres, parseFolders } from "./genres.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const PLEX_TOKEN = process.env.PLEX_TOKEN;
if (!PLEX_TOKEN) {
  console.error("✖ PLEX_TOKEN manquant. Copiez server/.env.example en server/.env et renseignez votre token Plex.");
  process.exit(1);
}
const plex = createPlex({
  // Préférer l'IP locale LAN (192.168.1.81) pour contourner le Remote Watch Pass Plex, avec fallback Tailscale
  url: process.env.PLEX_URL || "http://192.168.1.81:32400",
  token: PLEX_TOKEN,
  // Délai maximal d'une requête de métadonnées ou d'image vers Plex (en-têtes et corps compris)
  timeoutMs: Number(process.env.PLEX_TIMEOUT_MS) || 15000,
});

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

// -------------------------------------------------------------
// ROUTES API
// -------------------------------------------------------------
app.use(catalogRoutes({ plex, cache: createMemoryCache() }));
// Index de recherche construit peu après le démarrage (la première recherche ne l'attend pas),
// puis reconstruit en arrière-plan quand il a plus de NOMAD_SEARCH_TTL_MIN minutes
const librarySearch = createLibrarySearch({
  plexFetch: plex.plexFetch,
  ttlMs: (Number(process.env.NOMAD_SEARCH_TTL_MIN) || 15) * 60 * 1000,
});
if (process.env.NOMAD_SEARCH_WARMUP !== "0") {
  setTimeout(() => librarySearch.rebuild().catch((e) => console.error("Index de recherche :", e.message)), 3000).unref();
}
app.use(searchRoutes({ plex, librarySearch }));
app.use(radioRoutes({ plex, librarySearch, cache: createMemoryCache({ maxEntries: 200 }) }));
// Genres de la musique = dossiers de premier niveau ; NOMAD_MUSIC_GENRE_FOLDERS renomme ou écarte
// ceux qui n'en sont pas ("Dossier=Genre,Fourre-tout=")
app.use(genreRoutes({
  librarySearch,
  genres: createMusicGenres({ folders: parseFolders(process.env.NOMAD_MUSIC_GENRE_FOLDERS) }),
}));
app.use(streamRoutes({ plex }));
app.use(imageRoutes({
  plex,
  cacheDir: CACHE_DIR,
  // Cache disque pour les miniatures générées (avec les autres caches, hors du dossier de l'appli)
  imageCacheDir: process.env.NOMAD_IMAGE_CACHE_DIR || path.join(CACHE_DIR, "images"),
  imageCacheMb: Number(process.env.NOMAD_IMAGE_CACHE_MB) || 500,
  concurrency: Number(process.env.NOMAD_IMAGE_CONCURRENCY) || 4,
}));
app.use(transcodeRoutes({ plex, transcoder, offline }));
app.use(playbackRoutes({ plex, transcoder, logDir: process.env.NOMAD_LOG_DIR || path.join(CACHE_DIR, "logs") }));

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
  console.log(`🔗 Relié à Plex : ${plex.url}`);
  console.log(`🚀 Compression HTTP & Cache WebP actif`);
});
