import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { MediaDetail } from "../types";
import { gatewayCaps } from "../streaming";
import {
  OfflineQuality,
  cacheImages,
  deleteFromCache,
  downloadToCache,
  offlineSupported,
  prepareOnServer,
  requestPersistence,
  serverStatus,
} from "../offline";

export interface DownloadEntry {
  id: string; // "<ratingKey>:<qualité>"
  serverKey: string | null; // clé du fichier préparé par la passerelle
  media: MediaDetail; // tout ce qu'il faut pour lire sans réseau
  quality: OfflineQuality;
  state: "preparing" | "downloading" | "done" | "error";
  progress: number; // 0..1 de l'étape en cours
  size?: number;
  error?: string;
  addedAt: number;
}

interface DownloadsContextType {
  supported: boolean; // navigateur (HTTPS) et passerelle (iGPU) compatibles
  reason: string | null;
  entries: DownloadEntry[];
  forItem: (itemId: string) => DownloadEntry | undefined;
  start: (media: MediaDetail, quality: OfflineQuality) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
}

const STORAGE_KEY = "nomad-downloads";
const DownloadsContext = createContext<DownloadsContextType | null>(null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readStored(): DownloadEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<DownloadEntry[]>(readStored);
  const [serverOk, setServerOk] = useState(false);
  const running = useRef(new Map<string, AbortController>());
  const browserOk = offlineSupported();

  useEffect(() => {
    gatewayCaps().then((c) => setServerOk(c.offline));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Stockage plein
    }
  }, [entries]);

  const update = (id: string, patch: Partial<DownloadEntry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  // Préparation sur la passerelle, puis téléchargement dans le cache de l'appareil
  const run = async (entry: DownloadEntry) => {
    if (running.current.has(entry.id)) return;
    const controller = new AbortController();
    running.current.set(entry.id, controller);
    try {
      update(entry.id, { state: "preparing", progress: 0, error: undefined });
      const media = entry.media;
      const audioIndex = (media.audioStreams.find((s) => s.selected) || media.audioStreams[0])?.index;
      let st = await prepareOnServer(media.id, audioIndex, entry.quality);
      update(entry.id, { serverKey: st.key });
      while (st.state === "queued" || st.state === "encoding") {
        if (controller.signal.aborted) return;
        update(entry.id, { progress: st.progress });
        await sleep(2000);
        st = await serverStatus(st.key);
      }
      if (st.state === "error") throw new Error(st.error || "Préparation impossible");

      update(entry.id, { state: "downloading", progress: 0 });
      await cacheImages([media.thumb, media.art, media.grandparentThumb]);
      let lastTick = 0;
      const size = await downloadToCache(
        st.key,
        (loaded, total) => {
          if (Date.now() - lastTick < 400 || !total) return;
          lastTick = Date.now();
          update(entry.id, { progress: loaded / total });
        },
        controller.signal
      );
      update(entry.id, { state: "done", progress: 1, size });
    } catch (error) {
      if (!controller.signal.aborted) {
        update(entry.id, { state: "error", error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      running.current.delete(entry.id);
    }
  };

  // Téléchargements interrompus (appli fermée) : on les reprend au lancement
  useEffect(() => {
    if (!browserOk) return;
    readStored()
      .filter((e) => e.state === "preparing" || e.state === "downloading")
      .forEach((e) => run(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (media: MediaDetail, quality: OfflineQuality) => {
    const id = `${media.id}:${quality}`;
    // Seules les métadonnées sont gardées : les URLs de flux ne servent plus hors connexion
    const entry: DownloadEntry = { id, serverKey: null, media, quality, state: "preparing", progress: 0, addedAt: Date.now() };
    setEntries((prev) => [entry, ...prev.filter((e) => e.id !== id)]);
    requestPersistence();
    run(entry);
  };

  const remove = (id: string) => {
    running.current.get(id)?.abort();
    const entry = entries.find((e) => e.id === id);
    if (entry?.serverKey) deleteFromCache(entry.serverKey).catch(() => {});
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const retry = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (entry) run(entry);
  };

  const forItem = (itemId: string) =>
    entries.find((e) => e.media.id === itemId && e.state === "done") || entries.find((e) => e.media.id === itemId);

  const supported = browserOk && serverOk;
  const reason = !browserOk
    ? "Les téléchargements nécessitent l'adresse sécurisée (https://) de la passerelle."
    : !serverOk
    ? "Cette passerelle ne prépare pas de versions hors connexion."
    : null;

  return (
    <DownloadsContext.Provider value={{ supported, reason, entries, forItem, start, remove, retry }}>
      {children}
    </DownloadsContext.Provider>
  );
}

export function useDownloads() {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error("useDownloads must be used within a DownloadsProvider");
  return ctx;
}
