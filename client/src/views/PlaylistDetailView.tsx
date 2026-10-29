import React, { useState } from "react";
import { usePlaylist } from "../context/PlaylistContext";
import { useAudio } from "../context/AudioContext";
import { SwipeRow } from "../components/SwipeRow";
import { useWishlist } from "../context/WishlistContext";
import { PlaylistArt } from "../components/PlaylistArt";
import {
  BigPlayButton,
  CollectionHeader,
  MetaDot,
  TrackListHeader,
} from "../components/Collection";
import {
  Shuffle,
  Trash2,
  Edit3,
  ListPlus,
  Heart,
  ChevronUp,
  ChevronDown,
  X,
  Plus,
} from "lucide-react";
import { formatTrackDuration } from "../utils/format";

interface PlaylistDetailViewProps {
  playlistId: string;
  onBack: () => void;
  onExploreMusic?: () => void;
}

export const PlaylistDetailView: React.FC<PlaylistDetailViewProps> = ({
  playlistId,
  onBack,
  onExploreMusic,
}) => {
  const {
    getPlaylist,
    updatePlaylist,
    deletePlaylist,
    removeTrackFromPlaylist,
    reorderPlaylistTracks,
    showToast,
    openPlaylistModal,
  } = usePlaylist();
  const { playTrack, currentTrack, addToQueue, playNext } = useAudio();
  const { isSaved, toggle } = useWishlist();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const playlist = getPlaylist(playlistId);

  if (!playlist) {
    return (
      <div className="pt-10 text-center text-muted">
        <p className="text-lg font-semibold">Playlist introuvable</p>
        <button
          type="button"
          onClick={onBack}
          className="press mt-4 px-5 h-10 rounded-full bg-surface2 text-fg text-sm font-medium"
        >
          Retour
        </button>
      </div>
    );
  }

  const { tracks } = playlist;
  const totalMinutes = Math.round(
    tracks.reduce((sum, t) => sum + (t.duration || 0), 0) / 60000
  );

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks, 0);
    }
  };

  const handleShuffle = () => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playTrack(shuffled[0], shuffled, 0);
  };

  const handleAddAllToQueue = () => {
    if (tracks.length === 0) return;
    addToQueue(tracks);
    showToast(`${tracks.length} titres ajoutés à la file d'attente`);
  };

  const handleStartEdit = () => {
    setEditTitle(playlist.title);
    setEditDescription(playlist.description || "");
    setIsEditing(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    updatePlaylist(playlist.id, {
      title: editTitle.trim(),
      description: editDescription.trim(),
    });
    setIsEditing(false);
  };

  const handleDelete = () => {
    deletePlaylist(playlist.id);
    onBack();
  };

  return (
    <div className="anim-in">
      <CollectionHeader
        onBack={onBack}
        backLabel="Playlists"
        art={
          <PlaylistArt
            tracks={tracks}
            className="w-[140px] h-[140px] sm:w-[176px] sm:h-[176px] flex-shrink-0"
          />
        }
        eyebrow="Playlist personnalisée"
        title={playlist.title}
        meta={
          <>
            <span className="text-fg font-medium">
              {tracks.length} {tracks.length > 1 ? "titres" : "titre"}
            </span>
            {totalMinutes > 0 && (
              <>
                <MetaDot />
                <span>{totalMinutes} min</span>
              </>
            )}
            {playlist.description && (
              <>
                <MetaDot />
                <span className="truncate max-w-md">{playlist.description}</span>
              </>
            )}
          </>
        }
      />

      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
        <BigPlayButton
          onClick={handlePlayAll}
          label="Écouter la playlist"
          disabled={tracks.length === 0}
        />

        <button
          type="button"
          onClick={handleShuffle}
          disabled={tracks.length === 0}
          aria-label="Lecture aléatoire"
          className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-card disabled:opacity-40"
        >
          <Shuffle className="w-5 h-5" strokeWidth={1.9} />
        </button>

        <button
          type="button"
          onClick={handleAddAllToQueue}
          disabled={tracks.length === 0}
          aria-label="Ajouter toute la playlist à la file d'attente"
          title="Ajouter à la file d'attente"
          className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-card disabled:opacity-40"
        >
          <ListPlus className="w-5 h-5" strokeWidth={1.9} />
        </button>

        <button
          type="button"
          onClick={handleStartEdit}
          aria-label="Modifier la playlist"
          title="Modifier les infos"
          className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-card"
        >
          <Edit3 className="w-5 h-5" strokeWidth={1.9} />
        </button>

        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label="Supprimer la playlist"
          title="Supprimer la playlist"
          className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-accent hover:bg-card"
        >
          <Trash2 className="w-5 h-5" strokeWidth={1.9} />
        </button>
      </div>

      {/* Modal / zone d'édition des infos de la playlist */}
      {isEditing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-playlist-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 anim-in"
          onClick={() => setIsEditing(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-surface p-6 border border-line shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <h2 id="edit-playlist-title" className="text-lg font-bold">Modifier la playlist</h2>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                aria-label="Fermer"
                className="press w-8 h-8 rounded-full grid place-items-center text-muted hover:text-fg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Titre
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Nom de la playlist"
                  className="w-full h-11 px-4 rounded-xl border border-line bg-card text-[15px] outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Description (optionnelle)
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Ajoutez une description…"
                  className="w-full p-3 rounded-xl border border-line bg-card text-[14px] outline-none focus:border-accent resize-none"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="press px-4 h-10 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-surface2"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!editTitle.trim()}
                  className="press px-5 h-10 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-40"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation de suppression */}
      {confirmDelete && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-playlist-title"
          aria-describedby="delete-playlist-desc"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 anim-in"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-surface p-6 border border-line shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-playlist-title" className="text-lg font-bold text-fg">Supprimer la playlist ?</h2>
            <p id="delete-playlist-desc" className="mt-2 text-sm text-muted">
              Êtes-vous sûr de vouloir supprimer « {playlist.title} » ? Cette action est
              irréversible.
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="press px-4 h-10 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-surface2"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="press px-5 h-10 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liste des titres de la playlist */}
      <div className="mt-7">
        <TrackListHeader />

        {tracks.length === 0 ? (
          <div className="py-14 text-center text-muted">
            <p className="text-base font-semibold">Cette playlist est vide</p>
            <p className="mt-1 text-sm text-muted max-w-md mx-auto">
              Ajoutez des morceaux en cliquant sur le menu « + » ou « Ajouter à une playlist »
              sur n'importe quel titre d'un album ou de la recherche.
            </p>
            {onExploreMusic && (
              <button
                type="button"
                onClick={onExploreMusic}
                className="press mt-5 inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold shadow-md"
              >
                <Plus className="w-4 h-4" />
                Explorer la musique
              </button>
            )}
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-0.5">
            {tracks.map((track, idx) => {
              const isCurrent = currentTrack?.id === track.id;
              const saved = isSaved(track.id);

              return (
                <SwipeRow
                  key={`${track.id}-${idx}`}
                  onSwipeRight={() => openPlaylistModal(track)}
                  onSwipeLeft={() => {
                    playNext(track);
                    showToast("Sera lu ensuite");
                  }}
                >
                  <div
                    className="group grid grid-cols-[28px_minmax(0,1fr)_56px_auto] sm:grid-cols-[28px_minmax(0,1fr)_70px_auto] gap-2 sm:gap-4 items-center px-3 py-2 rounded-xl transition-colors hover:bg-card"
                  >
                    {/* Numéro ou indicateur */}
                    <span
                      className={`text-sm tabular-nums ${
                        isCurrent ? "text-accent-text font-bold" : "text-muted"
                      }`}
                    >
                      {idx + 1}
                    </span>

                    {/* Titre & sous-titre cliquables */}
                    <button
                      type="button"
                      onClick={() => playTrack(track, tracks, idx)}
                      className="min-w-0 text-left py-1"
                    >
                      <span
                        className={`block text-[15px] font-semibold truncate ${
                          isCurrent ? "text-accent-text" : ""
                        }`}
                      >
                        {track.title}
                      </span>
                      <span className="block text-[13px] text-muted truncate">
                        {[track.grandparentTitle, track.parentTitle].filter(Boolean).join(" · ")}
                      </span>
                    </button>

                    {/* Durée */}
                    <span className="text-sm text-muted text-right tabular-nums">
                      {formatTrackDuration(track.duration)}
                    </span>

                    {/* Actions de ligne : Monter / Descendre / Cœur / Supprimer */}
                    <div className="flex items-center gap-1 justify-end">
                      {/* Réorganisation */}
                      <div className="hidden sm:flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => reorderPlaylistTracks(playlist.id, idx, idx - 1)}
                          aria-label="Monter"
                          className="press w-5 h-4 grid place-items-center text-muted hover:text-fg disabled:opacity-20"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === tracks.length - 1}
                          onClick={() => reorderPlaylistTracks(playlist.id, idx, idx + 1)}
                          aria-label="Descendre"
                          className="press w-5 h-4 grid place-items-center text-muted hover:text-fg disabled:opacity-20"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Cœur (Ma liste) */}
                      <button
                        type="button"
                        onClick={() => toggle(track)}
                        aria-pressed={saved}
                        aria-label={saved ? "Retirer de ma liste" : "Ajouter à ma liste"}
                        className={`press w-9 h-9 rounded-full grid place-items-center hover:bg-surface3 ${
                          saved ? "text-accent" : "text-muted"
                        }`}
                      >
                        <Heart
                          className={`w-4 h-4 ${saved ? "fill-current" : ""}`}
                          strokeWidth={1.9}
                        />
                      </button>

                      {/* Retirer de la playlist */}
                      <button
                        type="button"
                        onClick={() => removeTrackFromPlaylist(playlist.id, idx)}
                        aria-label={`Retirer ${track.title} de la playlist`}
                        title="Retirer de la playlist"
                        className="press w-9 h-9 rounded-full grid place-items-center text-muted hover:text-accent hover:bg-surface3"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={1.9} />
                      </button>
                    </div>
                  </div>
                </SwipeRow>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
