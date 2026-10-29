import React, { useState } from "react";
import { X, Plus, Check, ListMusic } from "lucide-react";
import { usePlaylist } from "../context/PlaylistContext";
import { PlaylistArt } from "./PlaylistArt";

export const PlaylistModal: React.FC = () => {
  const {
    modalTracks,
    closePlaylistModal,
    playlists,
    createPlaylist,
    addTrackToPlaylist,
  } = usePlaylist();

  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  if (!modalTracks || modalTracks.length === 0) return null;

  const firstTrack = modalTracks[0];
  const isMultiple = modalTracks.length > 1;

  const handleCreateAndAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const newPl = createPlaylist(newTitle.trim(), "", modalTracks);
    setIsCreating(false);
    setNewTitle("");
    closePlaylistModal();
  };

  const handleSelectPlaylist = (playlistId: string) => {
    addTrackToPlaylist(playlistId, modalTracks);
    closePlaylistModal();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="playlist-modal-title"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 anim-in"
      onClick={closePlaylistModal}
    >
      <div
        className="w-full max-w-lg bg-surface rounded-t-[28px] sm:rounded-[28px] border border-line shadow-2xl p-6 max-h-[85vh] flex flex-col anim-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-line">
          <div className="min-w-0">
            <h2 id="playlist-modal-title" className="text-xl font-bold tracking-tight">
              Ajouter à une playlist
            </h2>
            <p className="mt-0.5 text-xs text-muted truncate">
              {isMultiple
                ? `${modalTracks.length} titres sélectionnés`
                : `${firstTrack.title} · ${firstTrack.grandparentTitle || firstTrack.parentTitle || "Artiste"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={closePlaylistModal}
            aria-label="Fermer"
            className="press w-9 h-9 rounded-full bg-surface2 grid place-items-center text-muted hover:text-fg"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Formulaire création rapide de playlist */}
        <div className="py-4 border-b border-line">
          {!isCreating ? (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="press w-full flex items-center gap-3 p-3 rounded-2xl bg-card hover:bg-surface3 text-left font-medium text-sm text-fg transition-colors"
            >
              <span className="w-10 h-10 rounded-xl bg-accent-soft text-accent grid place-items-center flex-shrink-0">
                <Plus className="w-5 h-5" strokeWidth={2.2} />
              </span>
              <span>Créer une nouvelle playlist</span>
            </button>
          ) : (
            <form onSubmit={handleCreateAndAdd} className="flex flex-col gap-3">
              <input
                type="text"
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Nom de la playlist (ex: Coups de cœur, Road trip…)"
                className="w-full h-11 px-4 rounded-xl border border-line bg-card text-[15px] outline-none focus:border-accent"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setNewTitle("");
                  }}
                  className="press px-4 h-9 rounded-full text-xs font-semibold text-muted hover:text-fg hover:bg-surface2"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="press px-4 h-9 rounded-full bg-accent hover:bg-accent-hover text-white text-xs font-semibold disabled:opacity-40"
                >
                  Créer et ajouter
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Liste des playlists existantes */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar py-2 flex flex-col gap-1">
          {playlists.length === 0 ? (
            <div className="py-10 text-center text-muted">
              <ListMusic className="w-10 h-10 mx-auto mb-2 opacity-50" strokeWidth={1.5} />
              <p className="text-sm font-medium">Aucune playlist existante</p>
              <p className="mt-1 text-xs">Créez votre première playlist ci-dessus.</p>
            </div>
          ) : (
            playlists.map((pl) => {
              const containsTrack = !isMultiple && pl.tracks.some((t) => t.id === firstTrack.id);
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => handleSelectPlaylist(pl.id)}
                  className="press group w-full flex items-center gap-3 p-2.5 rounded-2xl hover:bg-card text-left transition-colors"
                >
                  <PlaylistArt tracks={pl.tracks} className="w-12 h-12 flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold truncate group-hover:text-accent-text transition-colors">
                      {pl.title}
                    </span>
                    <span className="block text-xs text-muted truncate">
                      {pl.tracks.length} {pl.tracks.length > 1 ? "titres" : "titre"}
                    </span>
                  </span>
                  {containsTrack ? (
                    <span className="w-7 h-7 rounded-full bg-ok/15 text-ok grid place-items-center text-xs">
                      <Check className="w-4 h-4" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span className="w-7 h-7 rounded-full border border-line2 grid place-items-center text-muted group-hover:text-fg group-hover:border-fg transition-colors">
                      <Plus className="w-4 h-4" strokeWidth={2} />
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
