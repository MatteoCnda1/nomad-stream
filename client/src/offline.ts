// Mode hors connexion : versions MP4 préparées par la passerelle (iGPU), stockées dans le cache du
// navigateur et servies par le service worker (/offline/<clé>.mp4), y compris sans réseau.
// Nécessite un contexte sécurisé (HTTPS, ou localhost) : sinon ni service worker ni Cache API.

export const OFFLINE_CACHE = "nomad-offline-v1"; // jamais purgé lors des mises à jour (voir sw.js)

export type OfflineQuality = "720p" | "480p";

export const OFFLINE_QUALITIES: { id: OfflineQuality; label: string; detail: string }[] = [
  { id: "720p", label: "Haute qualité · 720p", detail: "≈ 1,2 Go par heure" },
  { id: "480p", label: "Économie · 480p", detail: "≈ 0,5 Go par heure" },
];

export const offlineSupported = () =>
  typeof window !== "undefined" && window.isSecureContext && "caches" in window && "serviceWorker" in navigator;

export const offlineUrl = (key: string) => `/offline/${key}.mp4`;

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.quota ? { usage: e.usage || 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

// Demande au navigateur de ne pas effacer les vidéos téléchargées quand l'espace manque
export async function requestPersistence() {
  try {
    if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.();
  } catch {
    // Ignore
  }
}

export type ServerStatus = { key: string; state: "queued" | "encoding" | "ready" | "error"; progress: number; size: number | null; error: string | null };

export async function prepareOnServer(id: string, audioIndex: number | undefined, quality: OfflineQuality): Promise<ServerStatus> {
  const r = await fetch("/api/offline/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, audioIndex, quality }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export async function serverStatus(key: string): Promise<ServerStatus> {
  const r = await fetch(`/api/offline/status/${key}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Télécharge le fichier prêt directement dans le cache (en flux : jamais entièrement en mémoire)
export async function downloadToCache(key: string, onProgress: (loaded: number, total: number) => void, signal: AbortSignal) {
  const res = await fetch(`/api/offline/file/${key}.mp4`, { signal, cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  let loaded = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      onProgress(loaded, total);
      controller.enqueue(chunk);
    },
  });
  const headers: Record<string, string> = { "Content-Type": "video/mp4" };
  if (total) headers["Content-Length"] = String(total);
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.put(offlineUrl(key), new Response(res.body.pipeThrough(counter), { headers }));
  if (total && loaded !== total) {
    await cache.delete(offlineUrl(key));
    throw new Error("Téléchargement incomplet");
  }
  return loaded;
}

// Images (affiche, fond) gardées avec la vidéo pour que la page Téléchargements reste illustrée
export async function cacheImages(urls: (string | null | undefined)[]) {
  const cache = await caches.open(OFFLINE_CACHE);
  await Promise.all(
    urls.filter(Boolean).map(async (u) => {
      try {
        const r = await fetch(u as string);
        if (r.ok) await cache.put(u as string, r);
      } catch {
        // Une image manquante n'empêche pas la lecture
      }
    })
  );
}

export async function deleteFromCache(key: string) {
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.delete(offlineUrl(key));
}

export const formatBytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace(".", ",")} Go` : `${Math.max(1, Math.round(bytes / 1e6))} Mo`;
