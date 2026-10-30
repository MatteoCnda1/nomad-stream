// Genres de la musique (#50) : le genre d'un titre est son dossier de genre dans la bibliothèque
// musicale (« Rap FR », « Reggae », « Techno »…). C'est le classement de la maison :
// il couvre tous les titres et il est plus fin que les genres de Plex (21 grandes familles du
// catalogue AllMusic, présentes sur 44 % des albums seulement en octobre 2026).
// Mixes tout faits : des titres d'un genre tirés au hasard, variés.
import { normalize } from "./search.js";
import { songKey } from "./radio.js";

// Dossiers de premier niveau qui ne sont pas des genres : un artiste rangé à part (on lui donne
// son genre) ou un fourre-tout (vide : pas de genre). Remplacé par NOMAD_MUSIC_GENRE_FOLDERS.
export const DEFAULT_FOLDERS = "Black Sabbath=Metal,Queen=Rock,Divers=";

export function parseFolders(text = DEFAULT_FOLDERS) {
  const folders = new Map();
  for (const pair of String(text).split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) folders.set(normalize(pair.slice(0, eq)), pair.slice(eq + 1).trim());
  }
  return folders;
}

// Racines de la bibliothèque musicale chez Plex : soit des dossiers de genre côte à côte
// (/media/Music/Rap FR, /media/Music/Reggae… : chez nous, une racine Plex par genre), et le genre
// est la racine elle-même ; soit un dossier qui contient les genres (/media/Music)
export function rootRules(roots) {
  const clean = roots.map((r) => r.replace(/\/+$/, "")).filter(Boolean);
  const parent = (p) => p.slice(0, p.lastIndexOf("/"));
  return clean.map((root) => ({
    prefix: `${root}/`,
    genre: clean.some((other) => other !== root && parent(other) === parent(root)) ? root.slice(root.lastIndexOf("/") + 1) : null,
  }));
}

// Genre d'un fichier : sa racine (racines côte à côte) ou son dossier de premier niveau
export function genreOfFile(file, rules, folders = new Map()) {
  if (typeof file !== "string") return null;
  for (const rule of rules) {
    if (!file.startsWith(rule.prefix)) continue;
    let folder = rule.genre;
    if (!folder) {
      const rest = file.slice(rule.prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 1) return null; // fichier posé à la racine : pas de genre
      folder = rest.slice(0, slash);
    }
    const renamed = folders.get(normalize(folder));
    return renamed === undefined ? folder : renamed || null;
  }
  return null;
}

// Identifiant d'adresse : « Rap FR » → « rap-fr », « R&B » → « r-b »
export const genreId = (name) => normalize(name).replace(/ /g, "-");

export function createMusicGenres({ folders = parseFolders() } = {}) {
  // Genres d'un index, calculés une fois par index (il est reconstruit toutes les 15 min)
  const byIndex = new WeakMap();
  function genresOf(index) {
    let genres = byIndex.get(index);
    if (genres) return genres;
    genres = new Map();
    const rules = rootRules(index.musicRoots || []);
    for (const entry of index.entries) {
      if (entry.type !== "track" || !entry.item.partKey) continue;
      const name = genreOfFile(entry.file, rules, folders);
      const id = name && genreId(name);
      if (!id) continue;
      let genre = genres.get(id);
      if (!genre) genres.set(id, (genre = { id, name, tracks: [], artists: new Set(), albums: new Map() }));
      genre.tracks.push(entry);
      genre.artists.add(normalize(entry.item.grandparentTitle));
      // Pochettes de la mosaïque : les albums les plus écoutés et les plus fournis du genre
      const cover = entry.item.parentThumb || entry.item.thumb;
      const albumKey = entry.albumKey || entry.item.parentTitle;
      if (cover && albumKey) {
        const album = genre.albums.get(albumKey) || { cover, weight: 0 };
        album.weight += 1 + entry.popularity;
        genre.albums.set(albumKey, album);
      }
    }
    byIndex.set(index, genres);
    return genres;
  }

  const summary = (genre) => ({
    id: genre.id,
    name: genre.name,
    trackCount: genre.tracks.length,
    artistCount: genre.artists.size,
    covers: [...genre.albums.values()].sort((a, b) => b.weight - a.weight).slice(0, 4).map((a) => a.cover),
  });

  // Genres du plus fourni au moins fourni
  function list(index) {
    return [...genresOf(index).values()]
      .map(summary)
      .sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name, "fr"));
  }

  function info(index, id) {
    const genre = genresOf(index).get(id);
    return genre ? summary(genre) : null;
  }

  // Mix : titres du genre au hasard, chaque morceau une seule fois (pas le single et la version
  // album), une part par artiste pour qu'un artiste très présent dans le dossier n'occupe pas
  // tout le mix, et pas deux titres du même artiste d'affilée quand c'est possible
  function mix(index, id, { limit = 100, random = Math.random } = {}) {
    const genre = genresOf(index).get(id);
    if (!genre) return null;
    const pool = genre.tracks.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const cap = Math.max(2, Math.ceil((2 * limit) / genre.artists.size));
    const songs = new Set();
    const left = new Map(); // artiste → titres encore candidats
    const candidates = [];
    for (const e of pool) {
      const artist = normalize(e.item.grandparentTitle);
      const song = songKey(e.item);
      if (songs.has(song) || (left.get(artist) || 0) >= cap) continue;
      songs.add(song);
      left.set(artist, (left.get(artist) || 0) + 1);
      candidates.push({ item: e.item, artist });
    }
    // À chaque place : le premier candidat d'un autre artiste que le précédent. Un artiste qui
    // détient la moitié des candidats restants passe tout de suite, sinon il finirait en série.
    const picked = [];
    let last = null;
    while (picked.length < limit && candidates.length) {
      let forced = null;
      for (const [artist, n] of left) if (artist !== last && n >= (candidates.length + 1) / 2) forced = artist;
      let k = candidates.findIndex((c) => (forced ? c.artist === forced : c.artist !== last));
      if (k < 0) k = 0; // il ne reste que cet artiste
      const [chosen] = candidates.splice(k, 1);
      left.set(chosen.artist, left.get(chosen.artist) - 1);
      last = chosen.artist;
      picked.push(chosen.item);
    }
    return picked;
  }

  return { list, info, mix };
}
