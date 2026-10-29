// 9. Recherche globale : index approximatif de la bibliothèque (search.js), complété par la
//    recherche de Plex (éléments ajoutés depuis la dernière indexation, films trouvés par leurs
//    acteurs). Si l'index n'est pas prêt, la recherche de Plex seule, notée de la même façon.
import express from "express";
import { buildIndex, searchIndex } from "../search.js";

const LIMITS = { movie: 30, show: 30, artist: 30, album: 30, track: 60 };
// Recherche limitée à un type (`types=artist` : barre de recherche de l'onglet Musique)
const ONLY_LIMIT = 100;
const GROUPS = ["movies", "shows", "artists", "albums", "tracks"];
const EMPTY = { top: null, movies: [], shows: [], artists: [], albums: [], tracks: [] };

export function searchRoutes({ plex, librarySearch }) {
  const router = express.Router();

  async function plexSearch(q, limits) {
    const data = await plex.plexFetch(`/hubs/search?query=${encodeURIComponent(q)}&limit=15`);
    const items = (data.MediaContainer?.Hub || []).flatMap((h) => h.Metadata || []);
    const found = searchIndex(buildIndex(items), q, { limits });
    // Films et séries que Plex a trouvés par leurs acteurs ou réalisateurs (« reason ») : gardés
    // si le nom correspond à la recherche, juste au-dessus du seuil
    for (const raw of items) {
      if ((raw.type !== "movie" && raw.type !== "show") || !raw.reasonTitle || !limits[raw.type]) continue;
      const person = searchIndex(buildIndex([{ ratingKey: "0", type: "artist", title: raw.reasonTitle }]), q).top;
      const list = found[raw.type === "movie" ? "movies" : "shows"];
      if (person && !list.some((m) => m.id === raw.ratingKey)) {
        const [item] = buildIndex([raw]).entries.map((e) => e.item);
        list.push({ ...item, score: 0.62 });
      }
    }
    return found;
  }

  router.get("/api/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 120) : "";
    if (!q.trim()) return res.json(EMPTY);
    const only = String(req.query.types || "").split(",").filter((t) => Object.hasOwn(LIMITS, t));
    const limits = only.length
      ? Object.fromEntries(Object.keys(LIMITS).map((t) => [t, only.includes(t) ? ONLY_LIMIT : 0]))
      : LIMITS;

    const [library, fromPlex] = await Promise.allSettled([librarySearch.search(q, { limits }), plexSearch(q, limits)]);
    const lib = library.status === "fulfilled" ? library.value : null;
    const px = fromPlex.status === "fulfilled" ? fromPlex.value : null;
    if (!lib && !px) {
      const error = library.reason || fromPlex.reason;
      return res.status(502).json({ error: error?.message || "Recherche indisponible" });
    }

    // Union des deux, sans doublon, triée par note (à note égale, l'ordre de l'index)
    const result = { ...EMPTY };
    for (const g of GROUPS) {
      const seen = new Set();
      result[g] = [...(lib?.[g] || []), ...(px?.[g] || [])]
        .filter((item) => !seen.has(item.id) && seen.add(item.id))
        .sort((a, b) => b.score - a.score);
    }
    const tops = [lib?.top, px?.top].filter(Boolean);
    result.top = tops.reduce((best, t) => (t.score > best.score ? t : best), tops[0] ?? null);
    res.json(result);
  });

  return router;
}
