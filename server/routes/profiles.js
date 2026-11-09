// Profils, playlists et « Ma liste » (#40, #67) : voir userdata.js.
import express from "express";
import {
  cleanPlaylist,
  cleanProfileFields,
  cleanWishEntry,
  isItemId,
  isPlaylistId,
  isProfileId,
  LIMITS,
} from "../userdata.js";

export function profileRoutes({ userData, librarySearch }) {
  const router = express.Router();

  // Erreurs : 4xx annoncées (status), le reste en 500 sans détail du disque
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      console.error("Données des profils :", error.message);
      res.status(500).json({ error: "Données des profils indisponibles" });
    }
  };

  // Profil existant, sinon 404
  const profile = (fn) =>
    handle(async (req, res) => {
      const { pid } = req.params;
      if (!isProfileId(pid) || !(await userData.exists(pid))) return res.status(404).json({ error: "Profil introuvable" });
      await fn(req, res, pid);
    });

  router.get("/api/profiles", handle(async (req, res) => {
    res.json({ profiles: await userData.listProfiles() });
  }));

  router.post("/api/profiles", handle(async (req, res) => {
    const { fields, error } = cleanProfileFields(req.body);
    if (error) return res.status(400).json({ error });
    res.status(201).json(await userData.createProfile(fields));
  }));

  router.patch("/api/profiles/:pid", profile(async (req, res, pid) => {
    const { fields, error } = cleanProfileFields(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    res.json(await userData.updateProfile(pid, fields));
  }));

  router.delete("/api/profiles/:pid", profile(async (req, res, pid) => {
    await userData.deleteProfile(pid);
    res.status(204).end();
  }));

  // Playlists et « Ma liste » du profil, réparées si des titres ont été réimportés dans Plex.
  // L'index n'est pas attendu longtemps : sans lui, les données partent telles quelles.
  router.get("/api/profiles/:pid/data", profile(async (req, res, pid) => {
    const index = await librarySearch?.ready(3000).catch(() => null);
    const { doc, repaired } = await userData.getRepaired(pid, index);
    if (repaired) console.log(`🩹 Profil ${pid} : ${repaired} élément(s) réparé(s) ou signalé(s)`);
    res.json({ playlists: doc.playlists, wishlist: doc.wishlist, repaired });
  }));

  router.put("/api/profiles/:pid/playlists/:plid", profile(async (req, res, pid) => {
    const playlist = cleanPlaylist({ ...req.body, id: req.params.plid });
    if (!playlist) return res.status(400).json({ error: "Playlist invalide" });
    res.json(await userData.upsertPlaylist(pid, playlist));
  }));

  router.delete("/api/profiles/:pid/playlists/:plid", profile(async (req, res, pid) => {
    if (!isPlaylistId(req.params.plid)) return res.status(400).json({ error: "Playlist invalide" });
    await userData.deletePlaylist(pid, req.params.plid);
    res.status(204).end();
  }));

  router.put("/api/profiles/:pid/wishlist/:itemId", profile(async (req, res, pid) => {
    const entry = cleanWishEntry(req.body);
    if (!entry || entry.item.id !== req.params.itemId) return res.status(400).json({ error: "Élément invalide" });
    res.json(await userData.upsertWish(pid, entry));
  }));

  router.delete("/api/profiles/:pid/wishlist/:itemId", profile(async (req, res, pid) => {
    if (!isItemId(req.params.itemId)) return res.status(400).json({ error: "Élément invalide" });
    await userData.deleteWish(pid, req.params.itemId);
    res.status(204).end();
  }));

  // Données gardées jusqu'ici sur un appareil, versées dans le profil choisi
  router.post("/api/profiles/:pid/import", profile(async (req, res, pid) => {
    const playlists = (Array.isArray(req.body?.playlists) ? req.body.playlists : [])
      .slice(0, LIMITS.playlists)
      .map(cleanPlaylist)
      .filter(Boolean);
    const wishlist = (Array.isArray(req.body?.wishlist) ? req.body.wishlist : [])
      .slice(0, LIMITS.wishlist)
      .map(cleanWishEntry)
      .filter(Boolean);
    res.json({ added: await userData.importData(pid, { playlists, wishlist }) });
  }));

  return router;
}
