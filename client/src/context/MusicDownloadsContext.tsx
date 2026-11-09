// Playlists téléchargées : pour écouter sa musique sans connexion. Une playlist téléchargée le
// reste quand on la modifie : un titre ajouté est téléchargé à son tour, un titre retiré est
// effacé de l'appareil (sauf si une autre playlist téléchargée le contient).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MediaItem, Playlist } from "../types";
import { usePlaylist } from "./PlaylistContext";
import { prefetchedCopy } from "../audioPrefetch";
import { requestPersistence } from "../offline";
import { useProfiles } from "./ProfileContext";
import { localKey, readLocal } from "../profiles";
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

const FAILED_KEY = "nomad-music-failed"; // titres disparus du serveur, gardés d'une ouverture à l'autre
const PARALLEL = 2;
const RETRY_MS = 30000; // coupure réseau : nouvel essai après
const MusicDownloadsContext = createContext<MusicDownloadsContextType | null>(null);

const readIds = (key: string): string[] => {
  const parsed = readLocal<unknown>(key, []);
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
};

// Titres et pochettes téléchargés pour les autres profils de cet appareil : gardés aussi
function otherProfilesKeep(currentKey: string) {
  const parts = new Set<string>();
  const images = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || key === currentKey || !/^nomad-music-downloads-p_[a-f0-9]{12}$/.test(key)) continue;
    const ids = new Set(readIds(key));
    const playlists = readLocal<Playlist[]>(key.replace("music-downloads", "playlists"), []);
    for (const pl of Array.isArray(playlists) ? playlists : []) {
      if (!ids.has(pl.id)) continue;
      for (const t of pl.tracks || []) {
        const id = partIdOf(t);
        if (id) parts.add(id);
        if (t.thumb) {
          images.add(t.thumb);
          images.add(`${t.thumb}${t.thumb.includes("?") ? "&" : "?"}format=jpeg`);
        }
        if (t.parentThumb) images.add(t.parentThumb);
      }
    }
  }
  return { parts, images };
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
  const { profileId, remote } = useProfiles();
  const storageKey = localKey("music-downloads", profileId);
  const supported = musicOfflineSupported();
  // Premier profil choisi sur l'appareil : les téléchargements d'avant les profils le suivent
  // (ses playlists, versées dans le profil, gardent leurs identifiants)
  const [enabledIds, setEnabledIds] = useState<string[]>(() =>
    profileId && localStorage.getItem(storageKey) === null ? readIds(localKey("music-downloads", null)) : readIds(storageKey),
  );
  // Rien n'est effacé tant que les playlists du profil ne sont pas arrivées de la passerelle :
  // une copie locale encore vide ferait tout disparaître
  const settled = !profileId || remote?.profileId === profileId;
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

  // Playlist supprimée : son téléchargement aussi (son identifiant reste noté, sans effet)
  const existing = useMemo(
    () => enabledIds.filter((id) => playlists.some((p) => p.id === id)),
    [enabledIds, playlists],
  );
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(enabledIds));
    } catch {
      // Stockage plein
    }
  }, [enabledIds, storageKey]);

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
      if (hasDownloaded(id) || controllers.current.has(id) || failedRef.current[id] || track.unavailable) continue;
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
    const timer = window.setTimeout(() => {
      if (!settled) return;
      const others = otherProfilesKeep(storageKey);
      sweepDownloaded(new Set([...keep, ...others.parts]), new Set([...images, ...others.images]));
    }, 1000);
    pump();
    const controller = new AbortController();
    if (online) cacheImages(images, controller.signal);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [wanted, loaded, online, pump, storageKey, settled]);

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
    const ids = new Set<string>();
    const lost = new Set<string>(); // introuvables dans la bibliothèque (#67)
    for (const t of playlist.tracks) {
      const id = partIdOf(t);
      if (!id) continue;
      ids.add(id);
      if (t.unavailable) lost.add(id);
    }
    const all = [...ids];
    const done = all.filter(hasDownloaded).length;
    const failedCount = all.filter((id) => !hasDownloaded(id) && (failed[id] || lost.has(id))).length;
    return {
      enabled,
      total: all.length,
      done,
      failed: failedCount,
      active: enabled && done + failedCount < all.length,
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
