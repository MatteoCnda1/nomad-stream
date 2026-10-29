import React, { useState, useRef, useEffect } from "react";
import { ChevronLeft, Heart, MoreVertical, ListPlus, Plus, ListMusic } from "lucide-react";
import { MediaItem } from "../types";
import { formatTrackDuration } from "../utils/format";
import { usePlaylist } from "../context/PlaylistContext";
import { useAudio } from "../context/AudioContext";

// Bandeau d'en-tête teinté (Ma liste, album, artiste)
export const CollectionHeader: React.FC<{
  art: React.ReactNode;
  eyebrow: string;
  title: string;
  meta?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
}> = ({ art, eyebrow, title, meta, onBack, backLabel = "Retour" }) => (
  <div
    className="-mx-4 sm:-mx-6 lg:-mx-7 px-4 sm:px-6 lg:px-8 pt-[max(24px,env(safe-area-inset-top))] lg:-mt-20 lg:pt-[100px] pb-[30px]"
    style={{ background: "linear-gradient(180deg, var(--accent-soft), transparent)" }}
  >
    {onBack && (
      <button
        type="button"
        onClick={onBack}
        className="press mb-5 -ml-1 inline-flex items-center gap-1 h-10 pl-1.5 pr-3.5 rounded-full text-sm font-medium text-muted hover:text-fg hover:bg-card"
      >
        <ChevronLeft className="w-5 h-5" strokeWidth={2} />
        {backLabel}
      </button>
    )}
    <div className="flex flex-col sm:flex-row sm:items-end gap-5 sm:gap-7">
      {art}
      <div className="min-w-0">
        <div className="text-sm font-medium text-muted">{eyebrow}</div>
        <h1 className="mt-1.5 text-[40px] sm:text-[52px] xl:text-[64px] leading-none tracking-[-0.045em] font-bold line-clamp-2 pb-1">
          {title}
        </h1>
        {meta && <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted">{meta}</div>}
      </div>
    </div>
  </div>
);

export const CollectionArt: React.FC<{ src: string | null; round?: boolean }> = ({ src, round }) => (
  <img
    src={src || "/icon.svg"}
    alt=""
    decoding="async"
    className={`w-[140px] h-[140px] sm:w-[176px] sm:h-[176px] object-cover flex-shrink-0 bg-card shadow-[0_30px_60px_-24px_rgba(0,0,0,.55)] ${
      round ? "rounded-full" : "rounded-3xl"
    }`}
  />
);

export const MetaDot: React.FC = () => <span aria-hidden="true">·</span>;

// Gros bouton lecture rouge de la barre d'outils
export const BigPlayButton: React.FC<{ onClick: () => void; label: string; disabled?: boolean }> = ({
  onClick,
  label,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className="press w-14 h-14 rounded-full bg-accent hover:bg-accent-hover text-white grid place-items-center shadow-[0_14px_30px_-10px_rgba(229,19,29,.6)] disabled:opacity-40 disabled:shadow-none"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" />
    </svg>
  </button>
);

export const TRACK_ROW = "grid grid-cols-[28px_minmax(0,1fr)_56px_auto] sm:grid-cols-[28px_minmax(0,1fr)_70px_auto] gap-2.5 sm:gap-4 items-center";

export const TrackListHeader: React.FC = () => (
  <div className={`${TRACK_ROW} px-3 pb-2.5 border-b border-line text-[13px] text-muted`}>
    <span>#</span>
    <span>Titre</span>
    <span className="text-right">Durée</span>
    <span className="w-[76px]" />
  </div>
);

// Ligne de piste : numéro, titre, durée, cœur, menu options (file d'attente, playlist)
export const TrackRow: React.FC<{
  track: MediaItem;
  index: number;
  isCurrent: boolean;
  saved: boolean;
  onPlay: () => void;
  onToggleSaved: () => void;
  subtitle?: string;
}> = ({ track, index, isCurrent, saved, onPlay, onToggleSaved, subtitle }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { openPlaylistModal, showToast } = usePlaylist();
  const { playNext, addToQueue } = useAudio();

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <div className={`${TRACK_ROW} px-3 py-2 rounded-xl transition-colors hover:bg-card relative`}>
      <span className={`text-sm tabular-nums ${isCurrent ? "text-accent-text font-semibold" : "text-muted"}`}>
        {track.trackNumber || index + 1}
      </span>
      <button type="button" onClick={onPlay} className="min-w-0 text-left py-1">
        <span className={`block text-[15px] font-semibold truncate ${isCurrent ? "text-accent-text" : ""}`}>
          {track.title}
        </span>
        {subtitle && <span className="block text-[13px] text-muted truncate">{subtitle}</span>}
      </button>
      <span className="text-sm text-muted text-right tabular-nums">{formatTrackDuration(track.duration)}</span>
      
      <div className="flex items-center justify-end gap-0.5">
        <button
          type="button"
          onClick={onToggleSaved}
          aria-pressed={saved}
          aria-label={saved ? `Retirer ${track.title} de ma liste` : `Ajouter ${track.title} à ma liste`}
          className={`press w-9 h-9 rounded-full grid place-items-center hover:bg-surface3 ${saved ? "text-accent" : "text-muted"}`}
        >
          <Heart className={`w-[18px] h-[18px] ${saved ? "fill-current" : ""}`} strokeWidth={1.9} />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
            aria-label="Options du morceau"
            className="press w-9 h-9 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-surface3"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              className="absolute right-0 top-full mt-1.5 z-40 w-52 rounded-2xl bg-surface border border-line shadow-2xl p-1.5 flex flex-col gap-0.5 text-xs font-semibold anim-in"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  playNext(track);
                  showToast("Sera lu ensuite");
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-card text-fg text-left transition-colors"
              >
                <ListPlus className="w-4 h-4 text-muted" />
                <span>Écouter ensuite</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  addToQueue(track);
                  showToast("Ajouté à la file d'attente");
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-card text-fg text-left transition-colors"
              >
                <ListMusic className="w-4 h-4 text-muted" />
                <span>Ajouter à la file</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  openPlaylistModal(track);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-card text-fg text-left transition-colors"
              >
                <Plus className="w-4 h-4 text-muted" />
                <span>Ajouter à une playlist…</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
