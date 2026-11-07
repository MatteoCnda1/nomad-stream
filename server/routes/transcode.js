// Transcodeur iGPU de la passerelle : HLS multi-débits et versions hors connexion.
import express from "express";
import { isNumericId, isJobId } from "../validate.js";
import { preferExistingMedia } from "../availability.js";

export function transcodeRoutes({ plex, transcoder, offline }) {
  const { plexFetch } = plex;
  const router = express.Router();

  // Fichier source d'un média, tel que Plex le voit
  async function sourceOf(id) {
    // Version encore sur le disque d'abord (fiche avec une ancienne version au fichier disparu)
    const data = await plexFetch(`/library/metadata/${id}?checkFiles=1`);
    const item = data.MediaContainer?.Metadata?.[0];
    preferExistingMedia(item);
    return { item, part: item?.Media?.[0]?.Part?.[0] };
  }

  // 19. Transcodeur iGPU multi-débits (HLS ABR)
  router.get("/api/tx/available", (req, res) => {
    res.json({
      available: !!transcoder?.available,
      offline: !!offline,
      reason: transcoder ? transcoder.unavailableReason : "désactivé",
    });
  });

  router.post("/api/tx/start", async (req, res) => {
    if (!transcoder?.available) return res.status(503).json({ error: "Transcodeur indisponible" });
    const { id, audioIndex, start } = req.body || {};
    if (!isNumericId(String(id))) return res.status(400).json({ error: "id invalide" });
    try {
      const { item, part } = await sourceOf(id);
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

  router.get("/api/tx/:job/master.m3u8", (req, res) => {
    const job = isJobId(req.params.job) && transcoder?.getJob(req.params.job);
    if (!job) return res.status(404).send("Session inconnue");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(transcoder.masterPlaylist(job, Number(req.query.first) || 0));
  });

  router.get("/api/tx/:job/v:variant/index.m3u8", (req, res) => {
    const job = isJobId(req.params.job) && transcoder?.getJob(req.params.job);
    if (!job) return res.status(404).send("Session inconnue");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(transcoder.variantPlaylist(job));
  });

  router.get("/api/tx/:job/v:variant/:n.ts", async (req, res) => {
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
  router.get("/api/tx/:job/stop", stopTxJob);
  router.post("/api/tx/:job/stop", stopTxJob);

  router.get("/api/tx/status", (req, res) => res.json(transcoder ? transcoder.status() : []));

  // 20. Versions hors connexion (MP4 compacts préparés par l'iGPU, téléchargés par l'appli)
  router.post("/api/offline/prepare", async (req, res) => {
    if (!offline) return res.status(503).json({ error: "Mode hors connexion indisponible sur cette passerelle" });
    const { id, audioIndex, quality } = req.body || {};
    if (!isNumericId(String(id))) return res.status(400).json({ error: "id invalide" });
    try {
      const { item, part } = await sourceOf(id);
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

  router.get("/api/offline/status/:key", (req, res) => {
    const status = offline?.status(req.params.key);
    if (!status) return res.status(404).json({ error: "Inconnu" });
    res.json(status);
  });

  router.get("/api/offline/file/:key.mp4", (req, res) => {
    const file = offline?.readyFile(req.params.key);
    if (!file) return res.status(404).send("Pas encore prêt");
    res.sendFile(file, { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" } });
  });

  return router;
}
