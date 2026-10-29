// Recherche approximative dans toute la bibliothèque (films, séries, artistes, albums, titres).
// La recherche de Plex ne tolère ni les fautes de frappe (« harry poter »), ni les mots collés
// (« acdc », « spiderman ») ; et un nom d'artiste ne renvoyait pas ses titres. La passerelle garde
// donc un index en mémoire des titres de la bibliothèque, rafraîchi en arrière-plan, et note
// chaque élément : titre exact, début de titre, mots dans le désordre, fautes de frappe (distance
// de Damerau-Levenshtein bornée), et correspondance par artiste, année ou personnes du film.
import { SECTIONS, formatMediaItem, formatTrack } from "./plex.js";

// --- Normalisation ---

// Mots peu discriminants : ils comptent peu dans la note (« the », « le », « feat »…)
const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "le", "la", "les", "l", "de", "des", "du", "d", "un", "une", "et",
  "feat", "ft", "featuring", "with", "avec",
]);

// Minuscules, sans accents ni ponctuation : « Beyoncé » → « beyonce », « AC/DC » → « ac dc »,
// « A$AP » → « asap », « P!nk » → « pink ». Les élisions disparaissent (« Anatomie d'une chute »
// → « anatomie une chute ») : sinon « dune » se retrouvait dans « d une »
export function normalize(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/(?<![\p{L}\p{N}])(?:[cdjlmnst]|qu)['’ʼ`](?=\p{L})/gu, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/\$/g, "s")
    .replace(/(?<=\p{L})!(?=\p{L})/gu, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const tokenize = (text) => {
  const n = normalize(text);
  return n ? n.split(" ").map((t) => t.slice(0, 48)) : [];
};

// --- Distance d'édition ---

// Distance de Damerau-Levenshtein restreinte (transpositions de lettres voisines comprises),
// abandonnée dès qu'elle dépasse `max` : renvoie alors max + 1
const rows = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];
export function editDistance(a, b, max) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0 || lb === 0) return Math.max(la, lb);
  let [prev2, prev, cur] = rows;
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb];
}

// Fautes tolérées selon la longueur du mot tapé
const allowedTypos = (len) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

// Le mot tapé ressemble-t-il au début du mot `t` (mot en cours de frappe, avec une faute) ?
function prefixTypos(q, t, max) {
  let best = max + 1;
  for (const len of [q.length - 1, q.length, q.length + 1]) {
    if (len < 1 || len > t.length) continue;
    best = Math.min(best, editDistance(q, t.slice(0, len), max));
  }
  return best;
}

// Ressemblance d'un mot tapé `q` avec un mot du titre `t`, de 0 à 1. `last` : dernier mot de la
// recherche, peut-être pas encore fini (un début de mot suffit, même d'une seule lettre)
export function wordSimilarity(q, t, last = false) {
  if (q === t) return 1;
  if (t.startsWith(q)) {
    if (q.length === 1) return last ? 0.55 : 0;
    return 0.7 + (0.25 * q.length) / t.length;
  }
  const max = allowedTypos(q.length);
  if (max === 0) return 0;
  const d = editDistance(q, t, max);
  if (d <= max) {
    if (q.length < 5) return 0.6; // mot court : une faute le rapproche de trop de mots
    return d === 1 ? (q.length >= 8 ? 0.85 : 0.8) : 0.72;
  }
  if (last && q.length >= 4 && t.length > q.length && prefixTypos(q, t, 1) <= 1) {
    return q.length >= 5 ? 0.65 : 0.55;
  }
  return 0;
}

// Ressemblance de la recherche entière, sans espaces, avec un titre sans espaces (`tokens` : ses
// mots) : couvre les mots collés ou séparés (« acdc » / « AC/DC », « spider man » / « Spiderman »)
export function compactSimilarity(cq, ct, tokens = [ct]) {
  if (!cq || !ct) return 0;
  if (cq === ct) return 1;
  const ratio = cq.length / ct.length;
  if (ct.startsWith(cq)) return cq.length >= 2 ? 0.85 + 0.15 * ratio : 0.65;
  // Au milieu du titre : seulement à partir d'un début de mot (« man » ne trouve pas « Batman »)
  if (cq.length >= 3 && ct.includes(cq) && tokens.some((_, k) => tokens.slice(k).join("").startsWith(cq))) {
    return 0.7 + 0.15 * ratio;
  }
  if (cq.length < 5) return 0;
  const max = cq.length >= 9 ? 2 : 1;
  const d = editDistance(cq, ct, max);
  if (d <= max) return 0.9 - 0.08 * d;
  if (cq.length >= 7 && ct.length > cq.length && prefixTypos(cq, ct, max) <= max) return 0.72;
  return 0;
}

// --- Index ---

const TYPE_ORDER = { artist: 0, movie: 1, show: 2, album: 3, track: 4 };

// « Titre (feat. Artiste) » : l'artiste invité compte comme un artiste, pas comme le titre
const FEATURING = /^(.+?)[\s([]+(?:feat|ft|featuring)\b\.?(.*)$/i;

// Champs de recherche d'un élément Plex : titres (le titre et son titre original) et contexte
// (artiste d'un album ou d'un titre, année et personnes d'un film), qui compte un peu moins
function searchFields(raw) {
  const context = [];
  const add = (values, weight) => {
    const parts = values.map((v) => tokenize(v)).filter((t) => t.length);
    if (parts.length) context.push({ tokens: parts.flat(), parts: parts.map((t) => ({ tokens: t, compact: t.join("") })), weight });
  };
  let title = raw.title;
  const feat = raw.type === "track" || raw.type === "album" ? FEATURING.exec(title) : null;
  if (feat) {
    title = feat[1];
    add([feat[2]], 0.8);
  }
  // Le titre original d'un film (« The Lord of the Rings ») ; celui d'un titre de musique est son artiste
  const original = raw.type === "movie" || raw.type === "show" ? raw.originalTitle : null;
  const titles = [title, original].filter((t, i, all) => t && all.indexOf(t) === i);
  if (raw.type === "album") add([raw.parentTitle], 0.8);
  if (raw.type === "track") add([raw.grandparentTitle, raw.originalTitle], 0.8);
  if (raw.type === "movie" || raw.type === "show") {
    add([raw.year && String(raw.year)], 0.8);
    add([...(raw.Director || []), ...(raw.Role || []).slice(0, 4)].map((p) => p.tag), 0.7);
  }
  return {
    titles: titles.map((t) => {
      const tokens = tokenize(t);
      return { tokens, compact: tokens.join("") };
    }),
    context,
  };
}

export function buildIndex(rawItems) {
  const entries = [];
  const vocabulary = new Set();
  for (const raw of rawItems) {
    if (!raw?.ratingKey || !raw.title || !(raw.type in TYPE_ORDER)) continue;
    const fields = searchFields(raw);
    for (const t of fields.titles) t.tokens.forEach((w) => vocabulary.add(w));
    for (const c of fields.context) c.tokens.forEach((w) => vocabulary.add(w));
    // Élément tel que renvoyé au client (sans résumé : la recherche ne l'affiche pas)
    const item = raw.type === "track" ? formatTrack(raw) : formatMediaItem(raw);
    item.summary = "";
    if (raw.type === "track") item.trackNumber = undefined;
    entries.push({
      item,
      type: raw.type,
      fields,
      popularity: (raw.viewCount || 0) + Math.log10(1 + (raw.ratingCount || 0)),
      artistKey: raw.grandparentRatingKey, // titres : artiste (lecture continue)
    });
  }
  return { entries, vocabulary: [...vocabulary], builtAt: Date.now() };
}

// Note d'un élément pour la recherche : la meilleure entre la correspondance du titre entier et
// celle des mots un à un (chaque mot tapé prend sa meilleure ressemblance, titre ou contexte).
// À ressemblance égale, un titre entièrement couvert passe devant (« Nakamura » : l'album
// « NAKAMURA » avant l'artiste « Aya Nakamura »)
function scoreEntry(entry, query) {
  // Mêmes artistes sur des milliers de titres : une seule comparaison par texte et par recherche
  const compact = (p) => {
    let s = query.compactMemo.get(p.compact);
    if (s === undefined) query.compactMemo.set(p.compact, (s = compactSimilarity(query.compact, p.compact, p.tokens)));
    return s;
  };
  const { titles, context } = entry.fields;
  let best = 0;
  // Ressemblance de chaque mot tapé avec le contexte, et contexte écrit autrement (« jayz » pour
  // l'artiste « JAŸ-Z »)
  const inContext = query.words.map(() => 0);
  for (const c of context) {
    for (const p of c.parts) best = Math.max(best, compact(p) * c.weight);
    query.words.forEach((word, i) => {
      for (const t of c.tokens) inContext[i] = Math.max(inContext[i], (word.matches.get(t) || 0) * c.weight);
    });
  }
  for (const title of titles) {
    best = Math.max(best, compact(title));
    let sum = 0;
    query.words.forEach((word, i) => {
      let w = inContext[i];
      for (const t of title.tokens) w = Math.max(w, word.matches.get(t) || 0);
      sum += w * word.weight;
    });
    if (sum === 0) continue;
    let covered = 0;
    for (const t of title.tokens) {
      if (query.words.some((word) => (word.matches.get(t) || 0) >= 0.6)) covered++;
    }
    // Trouvé par le seul contexte (titres d'un artiste) : la pondération du contexte suffit
    const coverage = covered ? 0.9 + (0.1 * covered) / title.tokens.length : 1;
    best = Math.max(best, (sum / query.totalWeight) * coverage);
  }
  return best;
}

const MIN_SCORE = 0.62;

export function searchIndex(index, text, { limits = {} } = {}) {
  const tokens = tokenize(text);
  const empty = { top: null, movies: [], shows: [], artists: [], albums: [], tracks: [] };
  if (!tokens.length) return empty;
  // Le dernier mot est peut-être en cours de frappe (pas d'espace après)
  const typing = !/\s$/.test(text);
  const allStop = tokens.every((t) => STOP_WORDS.has(t));
  const words = [...new Set(tokens)].map((q, i, all) => {
    const last = typing && i === all.length - 1;
    const matches = new Map();
    for (const t of index.vocabulary) {
      const s = wordSimilarity(q, t, last);
      if (s > 0) matches.set(t, s);
    }
    return { matches, weight: !allStop && STOP_WORDS.has(q) ? 0.3 : 1 };
  });
  const query = {
    compact: tokens.join("").slice(0, 60),
    compactMemo: new Map(),
    words,
    totalWeight: words.reduce((s, w) => s + w.weight, 0),
  };

  const hits = [];
  for (const entry of index.entries) {
    const score = scoreEntry(entry, query);
    if (score >= MIN_SCORE) hits.push({ entry, score });
  }
  // Note arrondie, puis les plus écoutés, puis artiste > film > série > album > titre
  hits.sort(
    (a, b) =>
      Math.round(b.score * 50) - Math.round(a.score * 50) ||
      b.entry.popularity - a.entry.popularity ||
      TYPE_ORDER[a.entry.type] - TYPE_ORDER[b.entry.type],
  );

  // Types exclus de la recherche (limite à 0) : ni dans les listes, ni en meilleur résultat
  const first = hits.find((h) => (limits[h.entry.type] ?? 40) > 0);
  const result = { ...empty, top: first ? { ...first.entry.item, score: round(first.score) } : null };
  const groups = { movie: "movies", show: "shows", artist: "artists", album: "albums", track: "tracks" };
  for (const { entry, score } of hits) {
    const list = result[groups[entry.type]];
    if (list.length < (limits[entry.type] ?? 40)) list.push({ ...entry.item, score: round(score) });
  }
  return result;
}

const round = (s) => Math.round(s * 100) / 100;

// --- Index de la bibliothèque Plex, rafraîchi en arrière-plan ---

const PAGE = 2000;

export function createLibrarySearch({ plexFetch, ttlMs = 15 * 60 * 1000 }) {
  let index = null;
  let building = null;

  // Une bibliothèque entière, page par page (les titres de musique se comptent en milliers)
  async function fetchAll(section, type) {
    const items = [];
    for (let start = 0; ; start += PAGE) {
      const data = await plexFetch(
        `/library/sections/${section}/all?type=${type}&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE}`,
        { timeout: 60000 },
      );
      const page = data.MediaContainer?.Metadata || [];
      items.push(...page);
      const total = data.MediaContainer?.totalSize ?? items.length;
      if (page.length < PAGE || items.length >= total) return items;
    }
  }

  function rebuild() {
    if (building) return building;
    const t0 = Date.now();
    building = Promise.all([
      fetchAll(SECTIONS.movies, 1),
      fetchAll(SECTIONS.shows, 2),
      fetchAll(SECTIONS.music, 8),
      fetchAll(SECTIONS.music, 9),
      fetchAll(SECTIONS.music, 10),
    ])
      .then((lists) => {
        index = buildIndex(lists.flat());
        console.log(`🔎 Index de recherche : ${index.entries.length} éléments en ${Date.now() - t0} ms`);
        return index;
      })
      .finally(() => {
        building = null;
      });
    return building;
  }

  // Index prêt (reconstruit en arrière-plan s'il a vieilli) ; attend au plus `waitMs` le premier
  async function ready(waitMs) {
    if (index) {
      if (Date.now() - index.builtAt > ttlMs) rebuild().catch((e) => console.error("Index de recherche :", e.message));
      return index;
    }
    const timeout = new Promise((resolve) => setTimeout(resolve, waitMs, null).unref?.());
    return Promise.race([rebuild(), timeout]);
  }

  return {
    ready,
    rebuild,
    search: async (text, opts = {}) => {
      const idx = await ready(opts.waitMs ?? 8000);
      return idx ? searchIndex(idx, text, opts) : null;
    },
  };
}
