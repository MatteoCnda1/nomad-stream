// Lecture continue (#24) : quand la file d'attente se termine, la musique continue avec des
// titres proches du dernier écouté au lieu de reboucler sur le même morceau. Les titres viennent
// de l'index de recherche (toute la bibliothèque est déjà en mémoire) : artistes que Plex dit
// similaires, artistes du même genre, le même artiste, et une part de hasard.
import { normalize } from "./search.js";

// Tableau de bord musical de l'index, calculé une fois par index
const musicByIndex = new WeakMap();
function musicOf(index) {
  let music = musicByIndex.get(index);
  if (music) return music;
  const tracks = [];
  const byId = new Map();
  const byArtist = new Map();
  const genresOf = new Map();
  for (const entry of index.entries) {
    if (entry.type === "artist") genresOf.set(normalize(entry.item.title), new Set(entry.item.genres || []));
    if (entry.type !== "track" || !entry.item.partKey) continue;
    const artist = normalize(entry.item.grandparentTitle);
    tracks.push(entry);
    byId.set(entry.item.id, entry);
    if (!byArtist.has(artist)) byArtist.set(artist, []);
    byArtist.get(artist).push(entry);
  }
  music = { tracks, byId, byArtist, genresOf };
  musicByIndex.set(index, music);
  return music;
}

export const trackOf = (index, id) => musicOf(index).byId.get(id);

// Ordre de tirage : jamais deux titres du même artiste d'affilée quand c'est possible, et
// alternance des sources pour que la suite reste variée
const PATTERN = ["similar", "genre", "same", "similar", "genre", "any"];

export function pickRadio(index, { seed, similar = [], exclude = [], limit = 20, random = Math.random }) {
  const { tracks, byId, byArtist, genresOf } = musicOf(index);
  if (!tracks.length) return [];
  const seedEntry = byId.get(seed);
  const seedArtist = seedEntry ? normalize(seedEntry.item.grandparentTitle) : null;
  const seedGenres = (seedArtist && genresOf.get(seedArtist)) || new Set();
  const similarArtists = new Set(similar.map(normalize).filter((a) => a !== seedArtist && byArtist.has(a)));

  const pools = {
    same: seedArtist ? byArtist.get(seedArtist) || [] : [],
    similar: [...similarArtists].flatMap((a) => byArtist.get(a)),
    genre: seedGenres.size
      ? tracks.filter((e) => {
          const a = normalize(e.item.grandparentTitle);
          return a !== seedArtist && !similarArtists.has(a) && [...(genresOf.get(a) || [])].some((g) => seedGenres.has(g));
        })
      : [],
    any: tracks,
  };

  const excluded = new Set(exclude);
  if (seed) excluded.add(seed);
  // Le même morceau sur plusieurs albums (single, album, compilation) ne revient pas
  const songKey = (e) => `${normalize(e.item.grandparentTitle)}|${normalize(e.item.title.replace(/\s*[([].*$/, ""))}`;
  const seen = new Set(seedEntry ? [songKey(seedEntry)] : []);
  for (const id of excluded) {
    const e = byId.get(id);
    if (e) seen.add(songKey(e));
  }

  const picked = [];
  let lastArtist = seedArtist;
  for (let slot = 0; picked.length < limit && slot < limit * 6; slot++) {
    const kind = PATTERN[slot % PATTERN.length];
    // Source vide ou épuisée : la suivante, jusqu'au hasard complet
    const order = [kind, "similar", "genre", "any"].filter((k, i, all) => all.indexOf(k) === i && pools[k].length);
    let choice = null;
    for (const k of order) {
      const pool = pools[k];
      for (let attempt = 0; attempt < 12 && !choice; attempt++) {
        const e = pool[Math.floor(random() * pool.length)];
        const artist = normalize(e.item.grandparentTitle);
        if (excluded.has(e.item.id) || seen.has(songKey(e))) continue;
        if (artist === lastArtist && attempt < 8) continue;
        choice = e;
      }
      if (choice) break;
    }
    if (!choice) continue;
    picked.push(choice.item);
    excluded.add(choice.item.id);
    seen.add(songKey(choice));
    lastArtist = normalize(choice.item.grandparentTitle);
  }
  return picked;
}
