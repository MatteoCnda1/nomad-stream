// Genres de la musique et mixes tout faits par genre (#50). Tout vient de l'index de recherche :
// aucun appel à Plex de plus.
import express from "express";
import { clampInt } from "../validate.js";

const isGenreId = (v) => typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(v);

export function genreRoutes({ librarySearch, genres }) {
  const router = express.Router();

  // L'index se construit en arrière-plan au démarrage : 503 le temps qu'il soit prêt
  async function readyIndex(res) {
    const index = await librarySearch.ready(8000).catch(() => null);
    if (!index) res.status(503).json({ error: "Bibliothèque en cours d'indexation, réessayez dans un instant" });
    return index;
  }

  router.get("/api/music/genres", async (req, res) => {
    const index = await readyIndex(res);
    if (index) res.json({ items: genres.list(index) });
  });

  router.get("/api/music/genres/:id/mix", async (req, res) => {
    const { id } = req.params;
    if (!isGenreId(id)) return res.status(400).json({ error: "genre invalide" });
    const index = await readyIndex(res);
    if (!index) return;
    const genre = genres.info(index, id);
    if (!genre) return res.status(404).json({ error: "genre inconnu" });
    const limit = clampInt(req.query.limit, 100, 1, 200);
    res.json({ genre, items: genres.mix(index, id, { limit }) });
  });

  return router;
}
