// Progression propre à chaque profil (#39). Sans profils, tout le monde partageait la position de
// reprise du compte Plex : un invité qui regardait un film déplaçait le « Reprendre » des autres.
//
// Le profil lié à Plex (userdata.js, isPlexLinked) garde la progression de Plex, comme avant. Pour
// les autres, la passerelle tient la sienne et la met à la place de celle de Plex dans toutes les
// réponses (fiches, listes, recherche), et construit leur « Continuer la lecture » (en cours et
// épisode suivant d'une série terminée). Le profil vient du cookie nomad_profile, posé par l'appli.
import { episodesAfter, formatMediaItem } from "./plex.js";
import { isPlexLinked, isProfileId } from "./userdata.js";

export const PROFILE_COOKIE = "nomad_profile";
const WATCHED = 0.9; // comme Plex : vu au-delà de 90 %
const ON_DECK_MAX = 20;
const TRACKED = new Set(["movie", "episode"]);

export function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Position d'un profil à la place de celle de Plex, partout dans une réponse (copie), avec ce
// qu'il a vu et quand (épisode à proposer sur la fiche d'une série, #98)
export function overlayProgress(body, entries) {
  const visit = (v) => {
    if (Array.isArray(v)) return v.map(visit);
    if (!v || typeof v !== "object") return v;
    const out = {};
    for (const k of Object.keys(v)) out[k] = visit(v[k]);
    if (TRACKED.has(out.type) && typeof out.id === "string" && "viewOffset" in out) {
      const e = entries[out.id];
      const offset = e && !e.watched ? e.offset : 0;
      out.viewOffset = offset;
      out.progressPercent = out.duration > 0 ? Math.min(100, Math.round((offset / out.duration) * 100)) : 0;
      out.watched = !!e?.watched;
      // Épisode suivant mis en file (upNext) : pas encore regardé
      out.lastViewedAt = e && (e.watched || offset > 0) ? e.updatedAt : null;
    }
    return out;
  };
  return visit(body);
}

// Ce qui va dans « Continuer la lecture » : en cours, ou épisode suivant, du plus récent au plus ancien
export const deckIds = (entries) =>
  Object.entries(entries)
    .filter(([, e]) => !e.watched && (e.offset > 0 || e.upNext))
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, ON_DECK_MAX)
    .map(([id]) => id);

export function createProgress({ userData, plexFetch, availability }) {
  // Profil de la requête : { id, private } (private : progression tenue par la passerelle)
  async function profileOf(req) {
    const id = readCookie(req, PROFILE_COOKIE);
    if (!isProfileId(id)) return null;
    const list = await userData.listProfiles();
    const profile = list.find((p) => p.id === id);
    return profile ? { id, private: !isPlexLinked(profile, list) } : null;
  }

  // Middleware : req.nomadProfile, et réponses JSON corrigées pour un profil à progression propre
  const middleware = async (req, res, next) => {
    try {
      req.nomadProfile = await profileOf(req);
      if (req.nomadProfile?.private && req.method === "GET") {
        const entries = await userData.getProgress(req.nomadProfile.id);
        const json = res.json.bind(res);
        res.json = (body) => json(res.statusCode < 400 ? overlayProgress(body, entries) : body);
      }
    } catch (error) {
      console.error("Profil de la requête :", error.message);
    }
    next();
  };

  // Épisode suivant d'une série, ajouté au « Continuer la lecture » quand un épisode est fini
  async function queueNextEpisode(profileId, ratingKey) {
    const next = (await episodesAfter(plexFetch, ratingKey))[0];
    if (!next) return;
    const entries = await userData.getProgress(profileId);
    const current = entries[next.ratingKey];
    if (current && !current.watched && current.offset > 0) return; // déjà entamé
    await userData.setProgress(
      profileId,
      String(next.ratingKey),
      { offset: 0, duration: next.duration || 0, updatedAt: Date.now(), upNext: true },
      { now: true },
    );
  }

  // Rapport de lecture d'un profil à progression propre
  async function record(profileId, { ratingKey, state, time, duration }) {
    const entries = await userData.getProgress(profileId);
    const before = entries[ratingKey];
    const offset = Math.max(0, Math.round(time || 0));
    const total = Math.max(0, Math.round(duration || before?.duration || 0));
    const watched = total > 0 && offset / total >= WATCHED;
    await userData.setProgress(
      profileId,
      ratingKey,
      watched ? { offset: 0, duration: total, updatedAt: Date.now(), watched: true } : { offset, duration: total, updatedAt: Date.now() },
      { now: state === "stopped" || watched },
    );
    if (watched && !before?.watched) {
      queueNextEpisode(profileId, ratingKey).catch((e) => console.warn("Épisode suivant :", e.message));
    }
  }

  // « Continuer la lecture » d'un profil à progression propre
  async function onDeck(profileId) {
    const ids = deckIds(await userData.getProgress(profileId));
    const results = await Promise.allSettled(ids.map((id) => plexFetch(`/library/metadata/${id}`)));
    const items = results
      .map((r) => (r.status === "fulfilled" ? r.value.MediaContainer?.Metadata?.[0] : null))
      .filter((m) => m && TRACKED.has(m.type))
      .map(formatMediaItem);
    return availability ? availability.filter(items) : items;
  }

  return { middleware, record, onDeck };
}
