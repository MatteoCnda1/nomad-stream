// Préchargement de la musique (#56) : pendant l'écoute, le titre suivant de la file, le titre en
// cours puis celui d'après sont téléchargés en entier, un à la fois, dans le cache du navigateur
// (sur le disque, pas en mémoire). Le service worker les sert ensuite sous /precharge/<partId>,
// requêtes partielles comprises : le titre suivant démarre sans attendre le réseau, et une baisse
// de débit en cours de titre ne coupe plus la musique (le lecteur bascule sur la copie).
import { MediaItem } from "./types";

export const AUDIO_CACHE = "nomad-audio-v1"; // gardé lors des mises à jour de l'appli (voir sw.js)
const PREFIX = "/precharge/";
const BUDGET = 250e6; // au-delà, les titres préchargés les plus anciens sont effacés
const MAX_TRACK = 120e6; // mix d'une heure en FLAC : trop lourd, il reste lu en flux
const RETRY_MS = 20000; // après un échec réseau, pas de nouvel essai avant

const pathOf = (partId: string) => `${PREFIX}${partId}`;
export const streamUrlOf = (t: MediaItem) => t.streamUrl || `/api/stream/audio?key=${encodeURIComponent(t.partKey || "")}`;
export const isPrecharge = (src: string) => src.includes(PREFIX);

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

// Source à donner au lecteur : la copie préchargée si elle est complète, sinon le flux
export function audioSource(track: MediaItem): string {
  return track.partId && ready.has(track.partId) && usable() ? pathOf(track.partId) : streamUrlOf(track);
}

export const isPrefetched = (track: MediaItem | null) => !!track?.partId && ready.has(track.partId) && usable();

// Copie préchargée illisible (effacée par le navigateur faute de place) : on l'oublie
export function forgetPrefetched(track: MediaItem) {
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
  wanted = tracks.filter((t, i, all) => t.partId && all.findIndex((o) => o.partId === t.partId) === i);
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
async function download(track: MediaItem, signal: AbortSignal): Promise<boolean> {
  const res = await fetch(streamUrlOf(track), { signal, cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!total || total > MAX_TRACK) {
    await res.body.cancel().catch(() => {});
    return false;
  }
  let received = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
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
