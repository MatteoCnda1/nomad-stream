// Flux : lecture directe (vidéo, audio) et sessions HLS du transcodeur de Plex.
import express from "express";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { CLIENT_ID, PLEX_WEB_PROFILE, plexClientId, fetchPlex } from "../plex.js";
import { isNumericId, isSessionId, isPartKey, isHlsSubpath } from "../validate.js";

// Paliers de qualité du transcodage HLS. "original" recopie la vidéo sans la réencoder.
// Mesuré sur ce serveur (encodage logiciel) : 720p ≈ 2-4x temps réel, 1080p ≈ 1,5x seulement.
const QUALITY_PRESETS = {
  original: {},
  "1080p": { maxVideoBitrate: "8000", videoResolution: "1920x1080", videoQuality: "90" },
  "720p": { maxVideoBitrate: "4000", videoResolution: "1280x720", videoQuality: "90" },
  "480p": { maxVideoBitrate: "1500", videoResolution: "854x480", videoQuality: "80" },
  "360p": { maxVideoBitrate: "750", videoResolution: "640x360", videoQuality: "70" },
};

// En-têtes de Plex relayés tels quels au navigateur
const FORWARDED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
];

// Proxy de flux (fichier, audio, segments HLS) avec Range HTTP et contre-pression.
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
  } catch (error) {
    // Navigateur parti ou flux interrompu : pipeline a déjà détruit les deux côtés,
    // le navigateur (ou hls.js) relancera la requête si besoin. Seule la coupure venue de Plex
    // est notée (le navigateur qui abandonne un téléchargement est normal).
    if (!clientGone.signal.aborted) {
      console.error(`Flux coupé par Plex (${error.cause?.code || error.code || error.message}) : ${new URL(targetUrl).pathname}`);
    }
  } finally {
    clearInterval(watchdog);
  }
}

export function streamRoutes({ plex }) {
  const { plexUrl } = plex;
  const router = express.Router();

  // 12. Streaming direct fichier vidéo (MP4 Direct Play avec support Range HTTP)
  router.get("/api/stream/file", (req, res) => {
    const partKey = req.query.key;
    if (!isPartKey(partKey)) return res.status(400).send("Clé de fichier invalide");
    proxyStream(req, res, plexUrl(partKey));
  });

  // 13. Streaming Audio direct (Musique, CarPlay, écran de verrouillage)
  router.get("/api/stream/audio", (req, res) => {
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
  router.get("/api/stream/hls/start.m3u8", async (req, res) => {
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
  router.get("/api/stream/hls/session/:session/*", (req, res) => {
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
  router.get("/api/stream/hls/ping", async (req, res) => {
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
  router.get("/api/stream/hls/stop", stopHlsSession);
  router.post("/api/stream/hls/stop", stopHlsSession);

  return router;
}
