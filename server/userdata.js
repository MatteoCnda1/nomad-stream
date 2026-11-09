// Profils et données des utilisateurs gardées par la passerelle (#40) : playlists et « Ma liste »
// ne sont plus prisonnières d'un appareil. Un profil n'est pas un compte : il n'a pas de mot de
// passe (comme les profils d'une appli de streaming), l'accès à la passerelle reste protégé par
// le tailnet et le code d'accès éventuel.
//
// Stockage : un fichier JSON par profil dans NOMAD_DATA_DIR, plus la liste des profils, écrits
// de façon atomique (fichier temporaire puis renommage). Un fichier illisible n'est jamais
// écrasé : la requête échoue plutôt que de perdre des données.
//
// Réparation (#67) : un titre réimporté dans Plex (converti, déplacé) change d'identifiant, et
// l'ancien ne se lit plus. À la lecture des données, chaque élément dont l'identifiant a disparu
// est retrouvé dans l'index de la bibliothèque par son artiste, son album et son titre (ou titre
// et année pour un film), puis corrigé et réenregistré. Introuvable, il est marqué
// « unavailable » sans être supprimé : il redevient normal s'il réapparaît.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { normalize } from "./search.js";

export const LIMITS = { profiles: 12, playlists: 300, tracks: 3000, wishlist: 3000 };
export const PROFILE_COLORS = ["#e5131d", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"];

export const isProfileId = (v) => typeof v === "string" && /^p_[a-f0-9]{12}$/.test(v);
export const isPlaylistId = (v) => typeof v === "string" && /^pl_[A-Za-z0-9_]{1,64}$/.test(v);
export const isItemId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);

// --- Nettoyage de ce que l'appli envoie : seuls les champs connus, typés et bornés ---

const TYPES = new Set(["movie", "episode", "track", "show", "album", "artist"]);
const str = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strs = (v) =>
  Array.isArray(v) ? v.filter((s) => typeof s === "string").slice(0, 20).map((s) => s.slice(0, 100)) : [];
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function cleanItem(raw) {
  if (!raw || typeof raw !== "object" || !isItemId(raw.id) || !TYPES.has(raw.type)) return null;
  return compact({
    id: raw.id,
    key: str(raw.key) ?? "",
    type: raw.type,
    title: str(raw.title) ?? "",
    originalTitle: str(raw.originalTitle),
    parentTitle: str(raw.parentTitle),
    grandparentTitle: str(raw.grandparentTitle),
    seasonNumber: num(raw.seasonNumber),
    episodeNumber: num(raw.episodeNumber),
    summary: str(raw.summary, 2000) ?? "",
    year: num(raw.year),
    duration: num(raw.duration) ?? 0,
    durationMinutes: num(raw.durationMinutes) ?? 0,
    viewOffset: num(raw.viewOffset) ?? 0,
    progressPercent: num(raw.progressPercent) ?? 0,
    rating: num(raw.rating) ?? null,
    contentRating: str(raw.contentRating, 40),
    studio: str(raw.studio, 120),
    addedAt: num(raw.addedAt) ?? 0,
    thumb: str(raw.thumb) ?? null,
    art: str(raw.art) ?? null,
    parentThumb: str(raw.parentThumb) ?? null,
    grandparentThumb: str(raw.grandparentThumb) ?? null,
    genres: strs(raw.genres),
    directors: strs(raw.directors),
    roles: strs(raw.roles),
    partKey: str(raw.partKey) ?? null,
    partId: str(raw.partId, 40) ?? null,
    trackNumber: num(raw.trackNumber),
    unavailable: raw.unavailable === true ? true : undefined,
  });
}

export function cleanPlaylist(raw) {
  if (!raw || typeof raw !== "object" || !isPlaylistId(raw.id)) return null;
  const now = Date.now();
  return compact({
    id: raw.id,
    title: str(raw.title, 120)?.trim() || "Ma playlist",
    description: str(raw.description, 500) ?? "",
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
    tracks: (Array.isArray(raw.tracks) ? raw.tracks : [])
      .slice(0, LIMITS.tracks)
      .map(cleanItem)
      .filter((t) => t && t.type === "track"),
    coverArt: str(raw.coverArt) ?? undefined,
  });
}

export function cleanWishEntry(raw) {
  const item = cleanItem(raw?.item);
  return item ? { item, savedAt: num(raw.savedAt) ?? Date.now() } : null;
}

export function cleanProfileFields(raw, { partial = false } = {}) {
  const out = {};
  if (raw?.name !== undefined || !partial) {
    const name = str(raw?.name, 40)?.trim();
    if (!name) return { error: "Nom de profil requis" };
    out.name = name;
  }
  if (raw?.color !== undefined) {
    if (typeof raw.color !== "string" || !/^#[0-9a-f]{6}$/i.test(raw.color)) return { error: "Couleur invalide" };
    out.color = raw.color.toLowerCase();
  }
  return { fields: out };
}

// --- Réparation des identifiants (#67) ---

const n = (v) => normalize(v || "");

// Clés de reconnaissance d'un élément, de la plus précise à la plus large
function fingerprints(item) {
  const t = n(item.title);
  if (!t) return [];
  switch (item.type) {
    case "track": {
      const artist = n(item.grandparentTitle);
      return [`track|${artist}|${n(item.parentTitle)}|${t}`, `track|${artist}|${t}`];
    }
    case "album":
      return [`album|${n(item.parentTitle)}|${t}`];
    case "artist":
      return [`artist|${t}`];
    case "movie":
    case "show":
      return item.year ? [`${item.type}|${t}|${item.year}`, `${item.type}|${t}`] : [`${item.type}|${t}`];
    default:
      return []; // épisodes : absents de l'index
  }
}

const lookups = new WeakMap();
function lookupOf(index) {
  let l = lookups.get(index);
  if (l) return l;
  const byId = new Map();
  const byKey = new Map(); // clé -> élément, ou null si plusieurs éléments la partagent
  for (const { item } of index.entries) {
    byId.set(item.id, item);
    for (const k of fingerprints(item)) {
      const prev = byKey.get(k);
      byKey.set(k, prev === undefined || prev?.id === item.id ? item : null);
    }
  }
  l = { byId, byKey, types: new Set(index.entries.map((e) => e.type)) };
  lookups.set(index, l);
  return l;
}

// Champs qui changent quand Plex réimporte un fichier
const FRESH = ["id", "key", "partKey", "partId", "thumb", "parentThumb", "grandparentThumb", "art", "duration", "durationMinutes"];

function refresh(item, fresh) {
  const next = { ...item };
  for (const f of FRESH) if (fresh[f] !== undefined) next[f] = fresh[f];
  delete next.unavailable;
  return next;
}

const sameFields = (a, b) => FRESH.every((f) => a[f] === b[f]) && !!a.unavailable === !!b.unavailable;

// Renvoie l'élément à jour (le même objet s'il n'a pas changé)
export function repairItem(item, index) {
  const { byId, byKey, types } = lookupOf(index);
  // Type absent de l'index (épisode, ou bibliothèque qui n'a pas pu être lue) : rien à dire
  if (!types.has(item.type)) return item;
  const current = byId.get(item.id);
  let next;
  if (current && current.type === item.type) {
    next = refresh(item, current);
  } else {
    const match = fingerprints(item).map((k) => byKey.get(k)).find(Boolean);
    next = match ? refresh(item, match) : { ...item, unavailable: true };
  }
  return sameFields(item, next) ? item : next;
}

// changed : éléments modifiés (à réenregistrer) ; repaired : ceux dont l'identifiant a changé
// ou qui ont disparu de la bibliothèque (les autres n'ont eu qu'une pochette ou un champ mis à jour)
export function repairData(doc, index) {
  let changed = 0;
  let repaired = 0;
  const fix = (item) => {
    const next = repairItem(item, index);
    if (next !== item) {
      changed++;
      if (next.id !== item.id || !!next.unavailable !== !!item.unavailable) repaired++;
    }
    return next;
  };
  const playlists = doc.playlists.map((pl) => {
    const tracks = pl.tracks.map(fix);
    return tracks.some((t, i) => t !== pl.tracks[i]) ? { ...pl, tracks } : pl;
  });
  // Deux entrées de « Ma liste » peuvent désigner désormais le même élément : une seule reste
  const seen = new Set();
  const wishlist = [];
  for (const e of doc.wishlist) {
    const item = fix(e.item);
    if (seen.has(item.id)) {
      changed++;
      repaired++;
      continue;
    }
    seen.add(item.id);
    wishlist.push(item === e.item ? e : { ...e, item });
  }
  return { doc: { playlists, wishlist }, changed, repaired };
}

// --- Stockage ---

export function createUserData({ dir }) {
  const profilesFile = path.join(dir, "profiles.json");
  const docFile = (id) => path.join(dir, "profiles", `${id}.json`);
  let profiles = null;
  const docs = new Map(); // id -> Promise<document>
  let writing = Promise.resolve();

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw new Error(`Fichier de données illisible (${path.basename(file)}) : ${error.message}`);
    }
  }

  // Écritures l'une après l'autre, chacune atomique
  function writeJson(file, data) {
    const json = JSON.stringify(data);
    writing = writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, json);
        await fs.rename(tmp, file);
      });
    return writing;
  }

  async function loadProfiles() {
    if (!profiles) {
      const data = await readJson(profilesFile, { profiles: [] });
      profiles = Array.isArray(data.profiles) ? data.profiles.filter((p) => isProfileId(p?.id)) : [];
    }
    return profiles;
  }

  const saveProfiles = () => writeJson(profilesFile, { version: 1, profiles });

  async function exists(id) {
    return (await loadProfiles()).some((p) => p.id === id);
  }

  function loadDoc(id) {
    if (!docs.has(id)) {
      const p = readJson(docFile(id), {}).then((d) => ({
        playlists: (Array.isArray(d.playlists) ? d.playlists : []).map(cleanPlaylist).filter(Boolean),
        wishlist: (Array.isArray(d.wishlist) ? d.wishlist : []).map(cleanWishEntry).filter(Boolean),
      }));
      p.catch(() => docs.delete(id)); // nouvel essai à la requête suivante
      docs.set(id, p);
    }
    return docs.get(id);
  }

  const saveDoc = (id, doc) => writeJson(docFile(id), { version: 1, ...doc });

  // Modification d'un document : lecture, changement synchrone, écriture
  async function mutate(id, fn) {
    const doc = await loadDoc(id);
    const result = fn(doc);
    await saveDoc(id, doc);
    return result;
  }

  return {
    dir,
    exists,
    listProfiles: loadProfiles,

    async createProfile(fields) {
      const list = await loadProfiles();
      if (list.length >= LIMITS.profiles) throw Object.assign(new Error("Nombre maximal de profils atteint"), { status: 409 });
      const profile = {
        id: `p_${crypto.randomBytes(6).toString("hex")}`,
        name: fields.name,
        color: fields.color || PROFILE_COLORS[list.length % PROFILE_COLORS.length],
        createdAt: Date.now(),
      };
      list.push(profile);
      await saveProfiles();
      return profile;
    },

    async updateProfile(id, fields) {
      const profile = (await loadProfiles()).find((p) => p.id === id);
      if (!profile) return null;
      Object.assign(profile, fields);
      await saveProfiles();
      return profile;
    },

    // Les données d'un profil supprimé sont mises de côté (dossier deleted/), pas effacées
    async deleteProfile(id) {
      const list = await loadProfiles();
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      await saveProfiles();
      docs.delete(id);
      await writing.catch(() => {});
      const deleted = path.join(dir, "deleted");
      await fs.mkdir(deleted, { recursive: true });
      await fs.rename(docFile(id), path.join(deleted, `${id}-${Date.now()}.json`)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      return true;
    },

    getData: loadDoc,

    // Données réparées avec l'index de la bibliothèque (enregistrées si quelque chose a changé)
    async getRepaired(id, index) {
      const doc = await loadDoc(id);
      if (!index) return { doc, repaired: 0 };
      const { doc: fixed, changed, repaired } = repairData(doc, index);
      if (changed) {
        doc.playlists = fixed.playlists;
        doc.wishlist = fixed.wishlist;
        await saveDoc(id, doc);
      }
      return { doc, repaired };
    },

    upsertPlaylist: (id, playlist) =>
      mutate(id, (doc) => {
        const i = doc.playlists.findIndex((p) => p.id === playlist.id);
        if (i >= 0) doc.playlists[i] = playlist;
        else if (doc.playlists.length >= LIMITS.playlists) throw Object.assign(new Error("Trop de playlists"), { status: 409 });
        else doc.playlists.unshift(playlist);
        return playlist;
      }),

    deletePlaylist: (id, playlistId) =>
      mutate(id, (doc) => {
        doc.playlists = doc.playlists.filter((p) => p.id !== playlistId);
      }),

    upsertWish: (id, entry) =>
      mutate(id, (doc) => {
        doc.wishlist = doc.wishlist.filter((e) => e.item.id !== entry.item.id);
        if (doc.wishlist.length >= LIMITS.wishlist) throw Object.assign(new Error("« Ma liste » est pleine"), { status: 409 });
        doc.wishlist.push(entry);
        doc.wishlist.sort((a, b) => b.savedAt - a.savedAt);
        return entry;
      }),

    deleteWish: (id, itemId) =>
      mutate(id, (doc) => {
        doc.wishlist = doc.wishlist.filter((e) => e.item.id !== itemId);
      }),

    // Données d'un appareil versées dans un profil : réunies avec celles déjà là. Une playlist
    // présente des deux côtés garde la version modifiée le plus récemment.
    importData: (id, { playlists, wishlist }) =>
      mutate(id, (doc) => {
        let added = 0;
        for (const pl of playlists) {
          const i = doc.playlists.findIndex((p) => p.id === pl.id);
          if (i < 0) {
            if (doc.playlists.length >= LIMITS.playlists) continue;
            doc.playlists.push(pl);
            added++;
          } else if (pl.updatedAt > doc.playlists[i].updatedAt) {
            doc.playlists[i] = pl;
          }
        }
        doc.playlists.sort((a, b) => b.createdAt - a.createdAt);
        for (const e of wishlist) {
          if (doc.wishlist.some((w) => w.item.id === e.item.id) || doc.wishlist.length >= LIMITS.wishlist) continue;
          doc.wishlist.push(e);
          added++;
        }
        doc.wishlist.sort((a, b) => b.savedAt - a.savedAt);
        return added;
      }),
  };
}
