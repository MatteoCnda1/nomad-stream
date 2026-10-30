import { HubData, MediaItem, MediaDetail, ShowDetail, ArtistDetail, AlbumDetail, SearchResults, MusicGenre, GenreMix } from "./types";

const BASE_URL = "";

// Cache mémoire client ultra-rapide (SWR / 0ms sur navigation d'onglets)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const apiCache = new Map<string, CacheEntry<any>>();
// Requêtes en cours : un préchargement et un clic simultanés ne déclenchent qu'un seul appel
const inFlight = new Map<string, Promise<any>>();

async function cachedFetch<T>(url: string, ttlMs = 30000): Promise<T> {
  const cached = apiCache.get(url);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.data;
  }
  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await fetch(url);
      if (res.status === 401) {
        // Cookie d'accès absent ou expiré : réveiller la porte d'entrée
        window.dispatchEvent(new CustomEvent("nomad-auth-required"));
        throw new Error("Authentification requise");
      }
      if (!res.ok) throw new Error(`HTTP Error [${res.status}]`);
      const data = await res.json();
      apiCache.set(url, { data, timestamp: Date.now() });
      return data as T;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, request);
  return request;
}

// Identifiant de cet appareil auprès de Plex (une session de transcodage par appareil).
// crypto.randomUUID n'existe qu'en contexte sécurisé (HTTPS) : on passe par getRandomValues.
export function getDeviceId(): string {
  const KEY = "nomad-device-id";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9-]{8,64}$/.test(existing)) return existing;
  } catch {
    // Stockage indisponible
  }
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Ignore
  }
  return id;
}

export function clearApiCache(endpointPrefix?: string) {
  if (!endpointPrefix) {
    apiCache.clear();
    return;
  }
  for (const key of apiCache.keys()) {
    if (key.includes(endpointPrefix)) {
      apiCache.delete(key);
    }
  }
}

export async function fetchServerStatus(): Promise<{ status: string; serverName: string; plexUrl: string; version?: string }> {
  return cachedFetch(`${BASE_URL}/api/status`, 15000);
}

export async function fetchHubs(): Promise<HubData> {
  return cachedFetch(`${BASE_URL}/api/hubs`, 30000);
}

export async function fetchMovies(offset = 0, limit = 40, sort = "titleSort:asc"): Promise<{ items: MediaItem[]; totalSize: number }> {
  return cachedFetch(`${BASE_URL}/api/movies?offset=${offset}&limit=${limit}&sort=${encodeURIComponent(sort)}`, 60000);
}

export async function fetchShows(offset = 0, limit = 40, sort = "titleSort:asc"): Promise<{ items: MediaItem[]; totalSize: number }> {
  return cachedFetch(`${BASE_URL}/api/shows?offset=${offset}&limit=${limit}&sort=${encodeURIComponent(sort)}`, 60000);
}

export async function fetchShowDetail(id: string): Promise<ShowDetail> {
  return cachedFetch(`${BASE_URL}/api/shows/${id}`, 120000);
}

export async function fetchMusicArtists(offset = 0, limit = 50, sort = "titleSort:asc"): Promise<{ items: MediaItem[]; totalSize: number }> {
  return cachedFetch(`${BASE_URL}/api/music/artists?offset=${offset}&limit=${limit}&sort=${encodeURIComponent(sort)}`, 120000);
}

export async function fetchArtistDetail(id: string): Promise<ArtistDetail> {
  return cachedFetch(`${BASE_URL}/api/music/artists/${id}`, 120000);
}

export async function fetchAlbumDetail(id: string): Promise<AlbumDetail> {
  return cachedFetch(`${BASE_URL}/api/music/albums/${id}`, 120000);
}

export async function fetchMetadata(id: string): Promise<MediaDetail> {
  return cachedFetch(`${BASE_URL}/api/metadata/${id}`, 300000);
}

// Préchargement (au toucher d'une vignette, à l'ouverture d'une fiche) : le lancement devient instantané
export function prefetchMetadata(id: string) {
  fetchMetadata(id).catch(() => {});
}

export async function searchPlex(query: string): Promise<SearchResults> {
  if (!query || query.trim().length === 0) {
    return { top: null, movies: [], shows: [], artists: [], albums: [], tracks: [] };
  }
  // Cache court de 15s pour les requêtes de recherche
  return cachedFetch(`${BASE_URL}/api/search?q=${encodeURIComponent(query)}`, 15000);
}

// Lecture continue : titres proches de `seedId`, hors titres déjà dans la file
export async function fetchRadio(seedId: string, excludeIds: string[], limit = 20): Promise<MediaItem[]> {
  const params = new URLSearchParams({ seed: seedId, exclude: excludeIds.join(","), limit: String(limit) });
  const res = await fetch(`${BASE_URL}/api/music/radio?${params}`);
  if (!res.ok) throw new Error(`HTTP Error [${res.status}]`);
  return (await res.json()).items;
}

// Genres de la musique (#50) : les dossiers de genre de la bibliothèque, avec leur mosaïque
export async function fetchMusicGenres(): Promise<MusicGenre[]> {
  return (await cachedFetch<{ items: MusicGenre[] }>(`${BASE_URL}/api/music/genres`, 300000)).items;
}

// Mix tout fait d'un genre : un nouveau tirage à chaque appel
export async function fetchGenreMix(genreId: string, limit = 100): Promise<GenreMix> {
  const res = await fetch(`${BASE_URL}/api/music/genres/${encodeURIComponent(genreId)}/mix?limit=${limit}`);
  if (!res.ok) throw new Error(res.status === 503 ? "Bibliothèque en cours d'indexation" : `HTTP Error [${res.status}]`);
  return res.json();
}

// Barre de recherche de l'onglet Musique : artistes seulement (recherche approximative)
export async function searchArtists(query: string): Promise<MediaItem[]> {
  const res = await cachedFetch<SearchResults>(`${BASE_URL}/api/search?q=${encodeURIComponent(query)}&types=artist`, 15000);
  return res.artists;
}

type TimelineParams = {
  ratingKey: string;
  key?: string;
  state: "playing" | "paused" | "stopped";
  time: number;
  duration: number;
};

// Les réponses mises en cache contiennent la position de reprise : on les oublie après chaque rapport
function forgetProgress(ratingKey: string) {
  apiCache.delete(`${BASE_URL}/api/hubs`);
  apiCache.delete(`${BASE_URL}/api/metadata/${ratingKey}`);
  clearApiCache("/api/shows/");
}

export async function reportTimeline(params: TimelineParams): Promise<void> {
  try {
    await fetch(`${BASE_URL}/api/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, client: getDeviceId() }),
    });
    forgetProgress(params.ratingKey);
  } catch (err) {
    console.warn("Timeline reporting failed:", err);
  }
}

// Variante pour la fermeture de page : navigator.sendBeacon survit à la destruction de l'onglet
export function beaconTimeline(params: TimelineParams) {
  const body = new Blob([JSON.stringify({ ...params, client: getDeviceId() })], { type: "application/json" });
  navigator.sendBeacon?.(`${BASE_URL}/api/timeline`, body);
  forgetProgress(params.ratingKey);
}

// Bilan d'une lecture pour le journal du serveur (envoyé à la fermeture du lecteur)
export type PlaybackSummary = {
  id: string;
  title: string;
  mode: "direct" | "hls" | "abr" | "local" | null;
  quality: string | null;
  ttffMs: number | null;
  watchedS: number;
  stalls: number;
  stallMs: number;
  qualitySwitches: number;
  restarts: number;
  cause: "network" | "transcoder" | null;
  bandwidthKbps: number | null;
  droppedFrames: number;
  totalFrames: number;
  error: string | null;
};

export function beaconPlaybackLog(summary: PlaybackSummary) {
  const body = new Blob([JSON.stringify({ ...summary, client: getDeviceId() })], { type: "application/json" });
  navigator.sendBeacon?.(`${BASE_URL}/api/playback/log`, body);
}

// --- Authentification (code d'accès partagé) ---

export async function checkAuth(): Promise<{ enabled: boolean; authed: boolean }> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/check`);
    if (!res.ok) return { enabled: true, authed: false };
    return await res.json();
  } catch {
    // Hors connexion : ne pas bloquer l'accès aux téléchargements
    return { enabled: false, authed: true };
  }
}

export async function login(code: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
