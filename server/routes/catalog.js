// Catalogue : statut, accueil, listes (films, séries, artistes), fiches détaillées et rapport
// de progression (scrobble). La recherche est dans routes/search.js.
import express from "express";
import { SECTIONS, PLEX_WEB_PROFILE, plexClientId, fetchPlex, formatMediaItem, formatListItem, formatTrack } from "../plex.js";
import { isNumericId } from "../validate.js";

export function catalogRoutes({ plex, cache }) {
  const { plexFetch, plexUrl } = plex;
  const router = express.Router();

  // Liste paginée d'une bibliothèque (Cache `ttl` secondes)
  const sectionList = (name, section, ttl, defaultLimit) => async (req, res) => {
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || defaultLimit;
    const sort = req.query.sort || "titleSort:asc";
    const cacheKey = `${name}_${offset}_${limit}_${sort}`;

    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const data = await plexFetch(`/library/sections/${section}/all?sort=${encodeURIComponent(sort)}&X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${limit}`);
      const totalSize = data.MediaContainer?.totalSize || 0;
      const items = (data.MediaContainer?.Metadata || []).map(formatListItem);

      const result = {
        items,
        offset,
        limit,
        totalSize,
      };
      cache.set(cacheKey, result, ttl);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // 1. Statut & Infos du serveur (Cache 15s)
  router.get("/api/status", async (req, res) => {
    const cached = cache.get("api_status");
    if (cached) return res.json(cached);

    try {
      const data = await plexFetch("/");
      const serverName = data.MediaContainer?.friendlyName || "Plex Nomad Server";
      const result = {
        status: "online",
        serverName,
        plexUrl: plex.url,
        version: data.MediaContainer?.version,
      };
      cache.set("api_status", result, 15);
      res.json(result);
    } catch (error) {
      res.status(502).json({ status: "error", message: error.message });
    }
  });

  // 2. Hubs d'accueil (Cache 30s)
  router.get("/api/hubs", async (req, res) => {
    const cached = cache.get("api_hubs");
    if (cached) return res.json(cached);

    try {
      const [onDeckRes, moviesRes, showsRes, musicRes] = await Promise.allSettled([
        plexFetch("/library/onDeck"),
        plexFetch(`/library/sections/${SECTIONS.movies}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=12`),
        // recentlyAdded renvoie des épisodes pour une bibliothèque de séries : on demande les séries
        // elles-mêmes, triées par date d'ajout de leur dernier épisode
        plexFetch(`/library/sections/${SECTIONS.shows}/all?type=2&sort=episode.addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=12`),
        plexFetch(`/library/sections/${SECTIONS.music}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=12`),
      ]);

      const items = (r, max) =>
        r.status === "fulfilled" ? (r.value.MediaContainer?.Metadata || []).slice(0, max).map(formatMediaItem) : [];

      const result = {
        onDeck: items(onDeckRes),
        recentMovies: items(moviesRes),
        recentShows: items(showsRes, 12),
        recentMusic: items(musicRes),
      };
      cache.set("api_hubs", result, 30);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 3. Films (Cache 60s)
  router.get("/api/movies", sectionList("movies", SECTIONS.movies, 60, 30));

  // 4. Séries (Cache 60s)
  router.get("/api/shows", sectionList("shows", SECTIONS.shows, 60, 30));

  // 5. Détail d'une Série avec ses Saisons et Épisodes (Cache 120s)
  router.get("/api/shows/:id", async (req, res) => {
    const showId = req.params.id;
    if (!isNumericId(showId)) return res.status(400).json({ error: "id invalide" });
    const cacheKey = `show_detail_${showId}`;
    const cached = cache.get(cacheKey);
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
      cache.set(cacheKey, result, 120);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 6. Musique (Artistes) (Cache 120s)
  router.get("/api/music/artists", sectionList("music_artists", SECTIONS.music, 120, 40));

  // 7. Détail d'un Artiste avec ses Albums (Cache 120s)
  router.get("/api/music/artists/:id", async (req, res) => {
    const artistId = req.params.id;
    if (!isNumericId(artistId)) return res.status(400).json({ error: "id invalide" });
    const cacheKey = `artist_detail_${artistId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const [artistData, albumsData] = await Promise.all([
        plexFetch(`/library/metadata/${artistId}`),
        plexFetch(`/library/metadata/${artistId}/children`),
      ]);

      const artist = formatMediaItem(artistData.MediaContainer?.Metadata?.[0]);
      const albums = (albumsData.MediaContainer?.Metadata || []).map(formatListItem);

      const result = {
        artist,
        albums,
      };
      cache.set(cacheKey, result, 120);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 8. Détail d'un Album avec ses Pistes (Cache 120s)
  router.get("/api/music/albums/:id", async (req, res) => {
    const albumId = req.params.id;
    if (!isNumericId(albumId)) return res.status(400).json({ error: "id invalide" });
    const cacheKey = `album_detail_${albumId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const [albumData, tracksData] = await Promise.all([
        plexFetch(`/library/metadata/${albumId}`),
        plexFetch(`/library/metadata/${albumId}/children`),
      ]);

      const album = formatMediaItem(albumData.MediaContainer?.Metadata?.[0]);
      const tracks = (tracksData.MediaContainer?.Metadata || []).map(formatTrack);

      const result = {
        album,
        tracks,
      };
      cache.set(cacheKey, result, 120);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 10. Détail complet d'un média (Streams audio, sous-titres, etc.) (Cache 300s)
  router.get("/api/metadata/:id", async (req, res) => {
    const id = req.params.id;
    if (!isNumericId(id)) return res.status(400).json({ error: "id invalide" });
    const cacheKey = `metadata_${id}`;
    const cached = cache.get(cacheKey);
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
      cache.set(cacheKey, result, 300);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 11. Reporting Timeline (Scrobble / Reprise de lecture synchronisée avec Plex)
  router.post("/api/timeline", async (req, res) => {
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
      cache.delete("api_hubs");
      cache.delete(`metadata_${ratingKey}`);
      cache.deletePrefix("show_detail_");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
