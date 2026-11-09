// Musique téléchargée (playlists hors connexion) : les fichiers des titres d'une playlist
// téléchargée sont gardés dans le cache du navigateur (sur le disque, jamais entièrement en
// mémoire) et servis par le service worker sous /offline-audio/<partId>, requêtes partielles
// comprises. Contrairement au préchargement (#56, audioPrefetch.ts), ce cache n'a pas de limite
// de taille et rien n'en part tout seul : un titre y reste tant qu'une playlist téléchargée le
// contient (voir MusicDownloadsContext).
import { MediaItem } from "./types";

export const MUSIC_CACHE = "nomad-music-v1"; // gardé lors des mises à jour de l'appli (voir sw.js)
const PREFIX = "/offline-audio/";
// Téléchargement qui ne reçoit plus rien (réseau mobile qui ne transmet plus, sans erreur)
const IDLE_MS = 20000;

export const downloadedPath = (partId: string) => `${PREFIX}${partId}`;
export const isDownloadedSrc = (src: string) => src.includes(PREFIX);

// Identifiant du fichier : les titres enregistrés dans une playlist avant cette version n'ont
// gardé que la clé du fichier (/library/parts/<partId>/<date>/<nom>)
export const partIdOf = (t: Pick<MediaItem, "partId" | "partKey">): string | null =>
  t.partId || /^\/library\/parts\/(\d+)\//.exec(t.partKey || "")?.[1] || null;

export const musicOfflineSupported = () =>
  typeof window !== "undefined" && window.isSecureContext && "caches" in window && "serviceWorker" in navigator;

// Le service worker doit contrôler la page pour servir /offline-audio/
const playable = () => musicOfflineSupported() && !!navigator.serviceWorker?.controller;

const stored = new Set<string>(); // titres complets dans le cache
const broken = new Set<string>(); // copies illisibles pendant cette session : lues en flux
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function subscribeDownloaded(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let loaded: Promise<void> | null = null;
export const loadDownloaded = () =>
  (loaded ??= (async () => {
    if (!musicOfflineSupported()) return;
    try {
      for (const request of await (await caches.open(MUSIC_CACHE)).keys()) {
        const path = new URL(request.url).pathname;
        if (path.startsWith(PREFIX)) stored.add(path.slice(PREFIX.length));
      }
    } catch {
      // Cache indisponible (navigation privée) : rien de téléchargé
    }
    notify();
  })());

// Présent sur l'appareil (affichage)
export const hasDownloaded = (partId: string | null | undefined) => !!partId && stored.has(partId);

// Lisible depuis l'appareil (lecteur)
export function isDownloaded(track: MediaItem | null | undefined): boolean {
  const id = track ? partIdOf(track) : null;
  return !!id && stored.has(id) && !broken.has(id) && playable();
}

export function downloadedSource(track: MediaItem): string | null {
  return isDownloaded(track) ? downloadedPath(partIdOf(track)!) : null;
}

// Copie illisible ou bloquée : lue en flux jusqu'à la prochaine ouverture de l'appli. Elle n'est
// effacée que si le navigateur l'a déjà fait disparaître (elle sera alors téléchargée à nouveau) :
// un simple blocage ne doit pas faire perdre un titre qu'on écoute hors connexion.
export function forgetDownloaded(track: MediaItem) {
  const id = partIdOf(track);
  if (!id) return;
  broken.add(id);
  caches
    .open(MUSIC_CACHE)
    .then((cache) => cache.match(downloadedPath(id)))
    .then((res) => {
      if (res) return;
      stored.delete(id);
      broken.delete(id);
      notify();
    })
    .catch(() => {});
}

// Erreur définitive (titre disparu du serveur) : inutile de réessayer tout seul
export class PermanentError extends Error {}

// Télécharge un titre dans le cache. `copy` : la version déjà préchargée pendant l'écoute,
// recopiée sans réseau quand elle existe.
export async function downloadTrack(track: MediaItem, signal: AbortSignal, copy?: Response): Promise<number> {
  const partId = partIdOf(track);
  if (!partId || !track.partKey) throw new PermanentError("Fichier inconnu");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let lastData = Date.now();
  const idle = window.setInterval(() => {
    if (Date.now() - lastData > IDLE_MS) controller.abort(new Error("Plus aucune donnée reçue"));
  }, 5000);
  try {
    const res =
      copy ??
      (await fetch(`/api/stream/audio?key=${encodeURIComponent(track.partKey)}`, {
        signal: controller.signal,
        cache: "no-store",
      }));
    lastData = Date.now();
    if (!res.ok || !res.body) {
      const message = `Titre indisponible sur le serveur (HTTP ${res.status})`;
      throw res.status >= 400 && res.status < 500 ? new PermanentError(message) : new Error(message);
    }
    const total = Number(res.headers.get("content-length")) || 0;
    let received = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        lastData = Date.now();
        received += chunk.byteLength;
        ctrl.enqueue(chunk);
      },
    });
    const headers: Record<string, string> = {
      "Content-Type": res.headers.get("content-type") || "audio/mpeg",
      "X-Nomad-Saved": String(Date.now()),
    };
    if (total) headers["Content-Length"] = String(total);
    const path = downloadedPath(partId);
    const cache = await caches.open(MUSIC_CACHE);
    await cache.put(path, new Response(res.body.pipeThrough(counter), { headers }));
    if (total && received !== total) {
      await cache.delete(path);
      throw new Error("Téléchargement incomplet");
    }
    stored.add(partId);
    broken.delete(partId);
    notify();
    return received;
  } finally {
    window.clearInterval(idle);
    signal.removeEventListener("abort", abort);
  }
}

// Pochettes gardées avec la musique : la playlist et le lecteur restent illustrés sans réseau
// (le service worker cherche les images dans tous les caches)
export async function cacheImages(urls: string[], signal: AbortSignal) {
  const cache = await caches.open(MUSIC_CACHE);
  for (const url of urls) {
    if (signal.aborted) return;
    try {
      if (await cache.match(url)) continue;
      const r = await fetch(url, { signal });
      if (r.ok) await cache.put(url, r);
    } catch {
      // Une pochette manquante n'empêche pas l'écoute
    }
  }
}

// Efface tout ce qu'aucune playlist téléchargée ne contient plus (titres et pochettes)
export async function sweepDownloaded(keepParts: Set<string>, keepImages: Set<string>) {
  if (!musicOfflineSupported()) return;
  try {
    const cache = await caches.open(MUSIC_CACHE);
    let changed = false;
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.startsWith(PREFIX)) {
        const id = path.slice(PREFIX.length);
        if (keepParts.has(id)) continue;
        await cache.delete(request);
        stored.delete(id);
        changed = true;
      } else if (!keepImages.has(path + url.search)) {
        await cache.delete(request);
      }
    }
    if (changed) notify();
  } catch {
    // Ignore
  }
}

// Place occupée par la musique téléchargée
export async function downloadedUsage(): Promise<number> {
  try {
    const cache = await caches.open(MUSIC_CACHE);
    let bytes = 0;
    for (const request of await cache.keys()) {
      const res = await cache.match(request);
      bytes += Number(res?.headers.get("content-length")) || 0;
    }
    return bytes;
  } catch {
    return 0;
  }
}
