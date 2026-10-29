// 21. Observabilité de la lecture : état du transcodeur pour le panneau de statistiques du lecteur,
//     et journal d'une ligne JSON par lecture (NOMAD_CACHE_DIR/logs/playback.jsonl)
import express from "express";
import { SEG } from "../transcoder.js";
import { createPlaybackLog, sanitizePlayback, summarizePlayback } from "../playback-log.js";
import { isJobId, isSessionId } from "../validate.js";

export function playbackRoutes({ plex, transcoder, logDir }) {
  const { plexFetch } = plex;
  const router = express.Router();
  const playbackLog = createPlaybackLog({ dir: logDir });

  router.get("/api/playback/stats", async (req, res) => {
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

  router.post("/api/playback/log", (req, res) => {
    const entry = sanitizePlayback(req.body);
    if (!entry) return res.status(400).json({ error: "Entrée invalide" });
    const client = typeof req.body.client === "string" && /^[A-Za-z0-9-]{8,64}$/.test(req.body.client) ? req.body.client : null;
    const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 200) : null;
    playbackLog.append({ at: new Date().toISOString(), client, ua, ...entry });
    console.log(summarizePlayback(entry));
    res.status(204).end();
  });

  return router;
}
