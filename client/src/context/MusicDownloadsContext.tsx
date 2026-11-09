// Playlists téléchargées : pour écouter sa musique sans connexion. Une playlist téléchargée le
// reste quand on la modifie : un titre ajouté est téléchargé à son tour, un titre retiré est
// effacé de l'appareil (sauf si une autre playlist téléchargée le contient).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MediaItem, Playlist } from "../types";
import { usePlaylist } from "./PlaylistContext";
import { prefetchedCopy } from "../audioPrefetch";
import { requestPersistence } from "../offline";
import {
  PermanentError,
  cacheImages,
  downloadTrack,
  hasDownloaded,
  loadDownloaded,
  musicOfflineSupported,
  partIdOf,
  subscribeDownloaded,
  sweepDownloaded,
} from "../musicOffline";

export interface PlaylistDownload {
  enabled: boolean; // l'utilisateur a demandé le téléchargement
  total: number; // titres téléchargeables de la playlist
  done: number; // déjà sur l'appareil
  failed: number; // indisponibles sur le serveur (fichier disparu, #67)
  active: boolean; // téléchargements en cours ou en attente
}

interface MusicDownloadsContextType {
  supported: boolean;
  reason: string | null;
  statusOf: (playlist: Playlist) => PlaylistDownload;
  enable: (playlistId: string) => void;
  disable: (playlistId: string) => void;
  retry: (playlistId: string) => void;
  isTrackDownloaded: (track: MediaItem) => boolean;
  downloadedPlaylists: Playlist[];
}

const STORAGE_KEY = "nomad-music-downloads";
const FAILED_KEY = "nomad-music-failed"; // titres disparus du serveur, gardés d'une ouverture à l'autre
const PARALLEL = 2;
const RETRY_MS = 30000; // coupure réseau : nouvel essai après
const MusicDownloadsContext = createContext<MusicDownloadsContextType | null>(null);

function readStored(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function readFailed(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAILED_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const imageOf = (t: MediaItem) => t.thumb || t.parentThumb || null;

export function MusicDownloadsProvider({ children }: { children: React.ReactNode }) {
  const { playlists } = usePlaylist();
  const supported = musicOfflineSupported();
  const [enabledIds, setEnabledIds] = useState<string[]>(readStored);
  const [, setVersion] = useState(0); // le contenu du cache a changé
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<Record<string, string>>(readFailed); // partId -> erreur définitive
  const [online, setOnline] = useState(navigator.onLine);
  const controllers = useRef(new Map<string, AbortController>());
  const retryAt = useRef(new Map<string, number>());
  const retryTimer = useRef<number>();

  useEffect(() => subscribeDownloaded(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    if (supported) loadDownloaded().then(() => setLoaded(true));
  }, [supported]);
  useEffect(() => {
    const up = () => {
      retryAt.current.clear();
      setOnline(true);
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // Playlist supprimée : son téléchargement aussi
  const existing = useMemo(
    () => enabledIds.filter((id) => playlists.some((p) => p.id === id)),
    [enabledIds, playlists],
  );
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch {
      // Stockage plein
    }
  }, [existing]);

  useEffect(() => {
    try {
      localStorage.setItem(FAILED_KEY, JSON.stringify(failed));
    } catch {
      // Stockage plein
    }
  }, [failed]);

  const downloadedPlaylists = useMemo(
    () => existing.map((id) => playlists.find((p) => p.id === id)!).filter(Boolean),
    [existing, playlists],
  );

  // Titres à garder sur l'appareil, dans l'ordre des playlists (les premiers arrivent d'abord)
  const wanted = useMemo(() => {
    const seen = new Set<string>();
    const out: MediaItem[] = [];
    for (const pl of downloadedPlaylists) {
      for (const t of pl.tracks) {
        const id = partIdOf(t);
        if (!id || !t.partKey || seen.has(id)) continue;
        seen.add(id);
        out.push(t);
      }
    }
    return out;
  }, [downloadedPlaylists]);

  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  const failedRef = useRef(failed);
  failedRef.current = failed;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const pump = useCallback(() => {
    // Avant la lecture du cache, tout paraîtrait à télécharger
    if (!supported || !loadedRef.current || !navigator.onLine) return;
    const now = Date.now();
    for (const track of wantedRef.current) {
      if (controllers.current.size >= PARALLEL) break;
      const id = partIdOf(track)!;
      if (hasDownloaded(id) || controllers.current.has(id) || failedRef.current[id]) continue;
      if ((retryAt.current.get(id) ?? 0) > now) continue;
      const controller = new AbortController();
      controllers.current.set(id, controller);
      (async () => {
        try {
          await downloadTrack(track, controller.signal, await prefetchedCopy(id));
          retryAt.current.delete(id);
        } catch (error) {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof PermanentError) {
            setFailed((f) => ({ ...f, [id]: message }));
          } else {
            console.warn("Téléchargement de musique interrompu :", message);
            retryAt.current.set(id, Date.now() + RETRY_MS);
            window.clearTimeout(retryTimer.current);
            retryTimer.current = window.setTimeout(pump, RETRY_MS);
          }
        } finally {
          controllers.current.delete(id);
          pump();
        }
      })();
    }
  }, [supported]);

  // Liste changée : on lance ce qui manque, on arrête et on efface ce qui n'est plus voulu
  useEffect(() => {
    if (!loaded) return;
    const keep = new Set(wanted.map((t) => partIdOf(t)!));
    for (const [id, controller] of controllers.current) if (!keep.has(id)) controller.abort();
    // Échecs des titres qui ne sont plus voulus : oubliés
    setFailed((f) => {
      const kept = Object.entries(f).filter(([id]) => keep.has(id));
      return kept.length === Object.keys(f).length ? f : Object.fromEntries(kept);
    });
    // Pochette affichée, et sa version JPEG pour l'écran verrouillé et CarPlay (voir AudioContext)
    const images = [
      ...new Set(
        wanted
          .map((t) => t.thumb)
          .filter((u): u is string => !!u)
          .flatMap((u) => [u, `${u}${u.includes("?") ? "&" : "?"}format=jpeg`])
          .concat(wanted.map(imageOf).filter((u): u is string => !!u)),
      ),
    ];
    const timer = window.setTimeout(() => sweepDownloaded(keep, new Set(images)), 1000);
    pump();
    const controller = new AbortController();
    if (online) cacheImages(images, controller.signal);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [wanted, loaded, online, pump]);

  useEffect(() => () => window.clearTimeout(retryTimer.current), []);

  const enable = (playlistId: string) => {
    requestPersistence(); // le navigateur ne doit pas effacer la musique quand l'espace manque
    setEnabledIds((ids) => (ids.includes(playlistId) ? ids : [...ids, playlistId]));
  };

  const disable = (playlistId: string) => setEnabledIds((ids) => ids.filter((id) => id !== playlistId));

  const retry = (playlistId: string) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    const ids = new Set(pl.tracks.map(partIdOf));
    ids.forEach((id) => id && retryAt.current.delete(id));
    setFailed((f) => Object.fromEntries(Object.entries(f).filter(([id]) => !ids.has(id))));
  };

  // Les échecs effacés, la file repart
  useEffect(() => {
    pump();
  }, [failed, pump]);

  const statusOf = (playlist: Playlist): PlaylistDownload => {
    const enabled = existing.includes(playlist.id);
    const ids = [...new Set(playlist.tracks.map(partIdOf).filter((id): id is string => !!id))];
    const done = ids.filter(hasDownloaded).length;
    const failedCount = ids.filter((id) => !hasDownloaded(id) && failed[id]).length;
    return {
      enabled,
      total: ids.length,
      done,
      failed: failedCount,
      active: enabled && done + failedCount < ids.length,
    };
  };

  const isTrackDownloaded = (track: MediaItem) => hasDownloaded(partIdOf(track));

  const reason = supported ? null : "Le téléchargement nécessite l'adresse sécurisée (https://) de la passerelle.";

  return (
    <MusicDownloadsContext.Provider
      value={{ supported, reason, statusOf, enable, disable, retry, isTrackDownloaded, downloadedPlaylists }}
    >
      {children}
    </MusicDownloadsContext.Provider>
  );
}

export function useMusicDownloads() {
  const ctx = useContext(MusicDownloadsContext);
  if (!ctx) throw new Error("useMusicDownloads must be used within a MusicDownloadsProvider");
  return ctx;
}
