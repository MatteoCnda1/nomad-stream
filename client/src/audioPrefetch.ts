// Préchargement de la musique (#56) : pendant l'écoute, le titre suivant de la file, le titre en
// cours puis celui d'après sont téléchargés en entier, un à la fois, dans le cache du navigateur
// (sur le disque, pas en mémoire). Le service worker les sert ensuite sous /precharge/<partId>,
// requêtes partielles comprises : le titre suivant démarre sans attendre le réseau, et une baisse
// de débit en cours de titre ne coupe plus la musique (le lecteur bascule sur la copie).
// La musique téléchargée (playlists hors connexion, musicOffline.ts) passe avant tout le reste.
import { MediaItem } from "./types";
import { downloadedSource, forgetDownloaded, isDownloaded, isDownloadedSrc } from "./musicOffline";

export const AUDIO_CACHE = "nomad-audio-v1"; // gardé lors des mises à jour de l'appli (voir sw.js)
const PREFIX = "/precharge/";
const BUDGET = 250e6; // au-delà, les titres préchargés les plus anciens sont effacés
const MAX_TRACK = 120e6; // mix d'une heure en FLAC : trop lourd, il reste lu en flux
const RETRY_MS = 20000; // après un échec réseau, pas de nouvel essai avant
// Téléchargement qui ne reçoit plus rien (VPN ou réseau mobile qui ne transmet plus, sans
// erreur) : abandonné, sinon il bloquerait tous les préchargements suivants jusqu'à la
// fermeture de l'appli
const IDLE_MS = 20000;

const pathOf = (partId: string) => `${PREFIX}${partId}`;
export const streamUrlOf = (t: MediaItem) => t.streamUrl || `/api/stream/audio?key=${encodeURIComponent(t.partKey || "")}`;
// Source lue depuis l'appareil : copie préchargée ou titre téléchargé
export const isPrecharge = (src: string) => src.includes(PREFIX) || isDownloadedSrc(src);

// Le service worker doit contrôler la page pour servir /precharge/ (HTTPS, dès la 2e ouverture)
const usable = () =>
  typeof window !== "undefined" && window.isSecureContext && "caches" in window && !!navigator.serviceWorker?.controller;

const ready = new Set<string>(); // titres complets dans le cache
const skipped = new Set<string>(); // trop lourds ou de taille inconnue
const retryAt = new Map<string, number>();
let wanted: MediaItem[] = [];
let running: { partId: string; controller: AbortController } | null = null;
let gate: () => boolean = () => true;
let retryTimer: number | undefined;

// Titres déjà en cache (ouvertures précédentes de l'appli)
let loaded: Promise<void> | null = null;
const load = () =>
  (loaded ??= caches
    .open(AUDIO_CACHE)
    .then((cache) => cache.keys())
    .then((keys) => keys.forEach((r) => ready.add(new URL(r.url).pathname.slice(PREFIX.length))))
    .catch(() => {}));

// Source à donner au lecteur : le titre téléchargé, sinon la copie préchargée si elle est
// complète, sinon le flux
export function audioSource(track: MediaItem): string {
  const downloaded = downloadedSource(track);
  if (downloaded) return downloaded;
  return track.partId && ready.has(track.partId) && usable() ? pathOf(track.partId) : streamUrlOf(track);
}

export const isPrefetched = (track: MediaItem | null) =>
  isDownloaded(track) || (!!track?.partId && ready.has(track.partId) && usable());

// Copie illisible (effacée par le navigateur faute de place) : on l'oublie. `src` : la source
// qui a échoué (titre téléchargé ou copie préchargée).
export function forgetPrefetched(track: MediaItem, src?: string) {
  if (src && isDownloadedSrc(src)) return forgetDownloaded(track);
  if (!track.partId) return;
  ready.delete(track.partId);
  const path = pathOf(track.partId);
  caches.open(AUDIO_CACHE).then((cache) => cache.delete(path)).catch(() => {});
}

// Le lecteur dit quand télécharger : pas tant que le titre en cours, lu en flux, manque d'avance
export function setPrefetchGate(fn: () => boolean) {
  gate = fn;
}

// Titres à précharger, par ordre de priorité. Un téléchargement qui n'en fait plus partie
// (titre sauté, file changée) est abandonné.
export function setPrefetchWanted(tracks: MediaItem[]) {
  // Un titre téléchargé n'a pas besoin d'être préchargé
  wanted = tracks.filter(
    (t, i, all) => t.partId && !isDownloaded(t) && all.findIndex((o) => o.partId === t.partId) === i,
  );
  if (running && !wanted.some((t) => t.partId === running!.partId)) running.controller.abort();
  kickPrefetch();
}

// Relance (titre suivant, avance suffisante, fin d'un téléchargement)
export function kickPrefetch() {
  if (!running && usable()) void pump();
}

async function pump() {
  await load();
  if (running || !gate()) return;
  const now = Date.now();
  const track = wanted.find(
    (t) => !ready.has(t.partId!) && !skipped.has(t.partId!) && (retryAt.get(t.partId!) ?? 0) <= now,
  );
  if (!track) return;
  const partId = track.partId!;
  const controller = new AbortController();
  running = { partId, controller };
  try {
    if (await download(track, controller.signal)) {
      ready.add(partId);
      retryAt.delete(partId);
      await evict();
    } else {
      skipped.add(partId);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.warn("Préchargement interrompu :", error);
      retryAt.set(partId, Date.now() + RETRY_MS);
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(kickPrefetch, RETRY_MS);
    }
  } finally {
    running = null;
  }
  kickPrefetch();
}

// Téléchargement en flux vers le cache (jamais entièrement en mémoire). Faux si le titre est
// trop lourd ou de taille inconnue (impossible alors de vérifier qu'il est complet).
async function download(track: MediaItem, outer: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer.addEventListener("abort", abort, { once: true });
  let lastData = Date.now();
  const idle = window.setInterval(() => {
    if (Date.now() - lastData > IDLE_MS) controller.abort(new Error("Plus aucune donnée reçue"));
  }, 5000);
  try {
    return await downloadTo(track, controller.signal, () => (lastData = Date.now()));
  } finally {
    window.clearInterval(idle);
    outer.removeEventListener("abort", abort);
  }
}

async function downloadTo(track: MediaItem, signal: AbortSignal, onData: () => void): Promise<boolean> {
  const res = await fetch(streamUrlOf(track), { signal, cache: "no-store" });
  onData();
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!total || total > MAX_TRACK) {
    await res.body.cancel().catch(() => {});
    return false;
  }
  let received = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      onData();
      received += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const path = pathOf(track.partId!);
  const cache = await caches.open(AUDIO_CACHE);
  await cache.put(
    path,
    new Response(res.body.pipeThrough(counter), {
      headers: {
        "Content-Type": res.headers.get("content-type") || "audio/mpeg",
        "Content-Length": String(total),
        "X-Nomad-Saved": String(Date.now()),
      },
    }),
  );
  if (received !== total) {
    await cache.delete(path);
    throw new Error("Téléchargement incomplet");
  }
  return true;
}

// Place bornée : les titres préchargés les plus anciens partent, jamais ceux qu'on attend
async function evict() {
  const cache = await caches.open(AUDIO_CACHE);
  const keep = new Set(wanted.map((t) => t.partId));
  const entries: { request: Request; partId: string; size: number; saved: number }[] = [];
  let total = 0;
  for (const request of await cache.keys()) {
    const res = await cache.match(request);
    const size = Number(res?.headers.get("content-length")) || 0;
    total += size;
    entries.push({
      request,
      partId: new URL(request.url).pathname.slice(PREFIX.length),
      size,
      saved: Number(res?.headers.get("x-nomad-saved")) || 0,
    });
  }
  entries.sort((a, b) => a.saved - b.saved);
  for (const e of entries) {
    if (total <= BUDGET) break;
    if (keep.has(e.partId)) continue;
    await cache.delete(e.request);
    ready.delete(e.partId);
    total -= e.size;
  }
}

// Copie complète déjà préchargée : recopiée telle quelle quand on télécharge le titre
export async function prefetchedCopy(partId: string): Promise<Response | undefined> {
  if (!ready.has(partId)) return undefined;
  try {
    return await (await caches.open(AUDIO_CACHE)).match(pathOf(partId));
  } catch {
    return undefined;
  }
}

// Place occupée (page Compte)
export async function prefetchUsage(): Promise<{ tracks: number; bytes: number }> {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    let bytes = 0;
    const keys = await cache.keys();
    for (const request of keys) bytes += Number((await cache.match(request))?.headers.get("content-length")) || 0;
    return { tracks: keys.length, bytes };
  } catch {
    return { tracks: 0, bytes: 0 };
  }
}

export async function clearPrefetched() {
  running?.controller.abort();
  ready.clear();
  skipped.clear();
  await caches.delete(AUDIO_CACHE).catch(() => {});
}
