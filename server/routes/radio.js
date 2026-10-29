// Lecture continue (#24) : titres proches d'un titre donné, pour prolonger une file terminée.
import express from "express";
import { SECTIONS, formatTrack } from "../plex.js";
import { pickRadio, trackOf } from "../radio.js";
import { isNumericId, clampInt } from "../validate.js";

export function radioRoutes({ plex, librarySearch, cache }) {
  const { plexFetch } = plex;
  const router = express.Router();

  // Artistes que Plex juge similaires (étiquettes « Similar » de l'artiste), gardés une heure
  async function similarArtists(artistKey) {
    if (!isNumericId(artistKey)) return [];
    const cacheKey = `similar_${artistKey}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    try {
      const data = await plexFetch(`/library/metadata/${artistKey}`);
      const names = (data.MediaContainer?.Metadata?.[0]?.Similar || []).map((s) => s.tag).filter(Boolean);
      cache.set(cacheKey, names, 3600);
      return names;
    } catch {
      return [];
    }
  }

  router.get("/api/music/radio", async (req, res) => {
    const seed = req.query.seed;
    if (!isNumericId(seed)) return res.status(400).json({ error: "seed invalide" });
    const exclude = String(req.query.exclude || "").split(",").filter(isNumericId).slice(0, 500);
    const limit = clampInt(req.query.limit, 20, 1, 50);

    try {
      const index = await librarySearch.ready(8000).catch(() => null);
      if (index) {
        // Artiste du titre de départ : depuis l'index, sinon depuis Plex (titre ajouté depuis)
        let artistKey = trackOf(index, seed)?.artistKey;
        if (!artistKey) {
          const data = await plexFetch(`/library/metadata/${seed}`).catch(() => null);
          artistKey = data?.MediaContainer?.Metadata?.[0]?.grandparentRatingKey;
        }
        const similar = await similarArtists(String(artistKey ?? ""));
        return res.json({ items: pickRadio(index, { seed, similar, exclude, limit }) });
      }
      // Index indisponible : titres au hasard, tirés par Plex
      const data = await plexFetch(
        `/library/sections/${SECTIONS.music}/all?type=10&sort=random&X-Plex-Container-Start=0&X-Plex-Container-Size=${limit + exclude.length}`,
      );
      const excluded = new Set([seed, ...exclude]);
      const items = (data.MediaContainer?.Metadata || [])
        .filter((t) => !excluded.has(t.ratingKey))
        .slice(0, limit)
        .map((t) => ({ ...formatTrack(t), trackNumber: undefined }));
      res.json({ items });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  return router;
}
