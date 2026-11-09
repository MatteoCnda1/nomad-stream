import React, { createContext, useContext, useMemo, useState, useRef } from "react";
import { MediaItem, Playlist } from "../types";
import { partIdOf } from "../musicOffline";
import { useSyncedList } from "../hooks/useSyncedList";

interface AddResult {
  addedCount: number;
  playlistTitle: string;
}

interface PlaylistContextType {
  playlists: Playlist[];
  createPlaylist: (title: string, description?: string, initialTracks?: MediaItem[]) => Playlist;
  updatePlaylist: (id: string, updates: { title?: string; description?: string }) => void;
  deletePlaylist: (id: string) => void;
  addTrackToPlaylist: (playlistId: string, trackOrTracks: MediaItem | MediaItem[]) => AddResult;
  removeTrackFromPlaylist: (playlistId: string, trackIndex: number) => void;
  reorderPlaylistTracks: (playlistId: string, fromIndex: number, toIndex: number) => void;
  getPlaylist: (id: string) => Playlist | undefined;
  // Modal pour ajouter à une playlist
  modalTracks: MediaItem[] | null;
  openPlaylistModal: (trackOrTracks: MediaItem | MediaItem[]) => void;
  closePlaylistModal: () => void;
  // Système de toast global
  toast: string | null;
  showToast: (msg: string) => void;
}

const PlaylistContext = createContext<PlaylistContextType | null>(null);

// Titres enregistrés sans l'identifiant de leur fichier (versions précédentes) : il se retrouve
// dans la clé du fichier. Sans lui, ni préchargement ni téléchargement.
const withPartIds = (pl: Playlist): Playlist =>
  (pl.tracks || []).every((t) => t.partId)
    ? pl
    : { ...pl, tracks: (pl.tracks || []).map((t) => (t.partId ? t : { ...t, partId: partIdOf(t) })) };

// Playlists du profil choisi, synchronisées avec la passerelle (#40)
export function PlaylistProvider({ children }: { children: React.ReactNode }) {
  const [stored, setPlaylists] = useSyncedList<Playlist>("playlists", (p) => p.id);
  const playlists = useMemo(() => stored.map(withPartIds), [stored]);
  const [modalTracks, setModalTracks] = useState<MediaItem[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
    }, 3200);
  };

  const createPlaylist = (title: string, description = "", initialTracks: MediaItem[] = []): Playlist => {
    const now = Date.now();
    const newPlaylist: Playlist = {
      id: `pl_${now}_${Math.random().toString(36).substring(2, 8)}`,
      title: title.trim() || "Ma playlist",
      description: description.trim(),
      createdAt: now,
      updatedAt: now,
      tracks: initialTracks,
    };
    setPlaylists((prev) => [newPlaylist, ...prev]);
    showToast(`Playlist « ${newPlaylist.title} » créée`);
    return newPlaylist;
  };

  const updatePlaylist = (id: string, updates: { title?: string; description?: string }) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== id) return pl;
        return {
          ...pl,
          title: updates.title !== undefined ? updates.title.trim() || pl.title : pl.title,
          description: updates.description !== undefined ? updates.description.trim() : pl.description,
          updatedAt: Date.now(),
        };
      })
    );
    showToast("Playlist mise à jour");
  };

  const deletePlaylist = (id: string) => {
    const target = playlists.find((p) => p.id === id);
    setPlaylists((prev) => prev.filter((pl) => pl.id !== id));
    if (target) {
      showToast(`Playlist « ${target.title} » supprimée`);
    }
  };

  const addTrackToPlaylist = (playlistId: string, trackOrTracks: MediaItem | MediaItem[]): AddResult => {
    const target = playlists.find((p) => p.id === playlistId);
    if (!target) return { addedCount: 0, playlistTitle: "" };

    const newTracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
    // Nettoyer les éléments pour ne stocker que l'essentiel
    const cleanTracks: MediaItem[] = newTracks.map((t) => ({
      id: t.id,
      key: t.key,
      type: "track",
      title: t.title,
      parentTitle: t.parentTitle,
      grandparentTitle: t.grandparentTitle,
      thumb: t.thumb,
      parentThumb: t.parentThumb,
      grandparentThumb: t.grandparentThumb,
      duration: t.duration,
      durationMinutes: t.durationMinutes || Math.round(t.duration / 60000),
      partKey: t.partKey,
      partId: partIdOf(t),
      trackNumber: t.trackNumber,
      genres: t.genres || [],
      directors: [],
      roles: [],
      summary: "",
      addedAt: t.addedAt || Date.now(),
      viewOffset: 0,
      progressPercent: 0,
      art: t.art,
    }));

    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        return {
          ...pl,
          tracks: [...pl.tracks, ...cleanTracks],
          updatedAt: Date.now(),
        };
      })
    );

    const count = cleanTracks.length;
    const msg =
      count === 1
        ? `Titre ajouté à « ${target.title} »`
        : `${count} titres ajoutés à « ${target.title} »`;
    showToast(msg);

    return { addedCount: count, playlistTitle: target.title };
  };

  const removeTrackFromPlaylist = (playlistId: string, trackIndex: number) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        const updated = [...pl.tracks];
        updated.splice(trackIndex, 1);
        return {
          ...pl,
          tracks: updated,
          updatedAt: Date.now(),
        };
      })
    );
    showToast("Titre retiré de la playlist");
  };

  const reorderPlaylistTracks = (playlistId: string, fromIndex: number, toIndex: number) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        if (fromIndex < 0 || fromIndex >= pl.tracks.length || toIndex < 0 || toIndex >= pl.tracks.length) {
          return pl;
        }
        const updated = [...pl.tracks];
        const [moved] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, moved);
        return {
          ...pl,
          tracks: updated,
          updatedAt: Date.now(),
        };
      })
    );
  };

  const getPlaylist = (id: string): Playlist | undefined => {
    return playlists.find((p) => p.id === id);
  };

  const openPlaylistModal = (trackOrTracks: MediaItem | MediaItem[]) => {
    setModalTracks(Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks]);
  };

  const closePlaylistModal = () => {
    setModalTracks(null);
  };

  return (
    <PlaylistContext.Provider
      value={{
        playlists,
        createPlaylist,
        updatePlaylist,
        deletePlaylist,
        addTrackToPlaylist,
        removeTrackFromPlaylist,
        reorderPlaylistTracks,
        getPlaylist,
        modalTracks,
        openPlaylistModal,
        closePlaylistModal,
        toast,
        showToast,
      }}
    >
      {children}
    </PlaylistContext.Provider>
  );
}

export function usePlaylist() {
  const ctx = useContext(PlaylistContext);
  if (!ctx) throw new Error("usePlaylist must be used within a PlaylistProvider");
  return ctx;
}
