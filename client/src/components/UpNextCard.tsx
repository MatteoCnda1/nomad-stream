import React, { useEffect, useRef } from "react";
import { Play, X } from "lucide-react";
import { MediaItem } from "../types";

interface UpNextCardProps {
  item: MediaItem;
  // Secondes avant le lancement automatique ; null : simple proposition, sans compte à rebours
  secondsLeft: number | null;
  total: number;
  onPlay: () => void;
  onCancel: () => void;
}

// Épisode suivant proposé à la fin d'un épisode (dans les dernières secondes, puis avec un compte
// à rebours à la fin), comme Netflix ou Prime Video
export const UpNextCard: React.FC<UpNextCardProps> = ({ item, secondsLeft, total, onPlay, onCancel }) => {
  const playRef = useRef<HTMLButtonElement>(null);
  const counting = secondsLeft != null;
  const elapsed = counting ? Math.min(1, (total - secondsLeft) / total) : 0;

  // Au clavier, Entrée lance tout de suite l'épisode suivant
  useEffect(() => {
    if (counting) playRef.current?.focus({ preventScroll: true });
  }, [counting]);

  const code = item.seasonNumber != null && item.episodeNumber != null ? `S${item.seasonNumber} · É${item.episodeNumber}` : null;

  return (
    <div
      role="region"
      aria-label="Épisode suivant"
      onTouchEnd={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-20 right-4 sm:right-6 bottom-[max(104px,calc(env(safe-area-inset-bottom)+96px))] w-[min(380px,calc(100vw-32px))] rounded-2xl bg-[#17171b]/95 backdrop-blur-md border border-white/10 shadow-[0_24px_48px_-16px_rgba(0,0,0,.8)] p-3 anim-in"
    >
      <div className="flex gap-3">
        <div className="relative w-28 sm:w-32 aspect-video flex-shrink-0 rounded-xl overflow-hidden bg-white/5">
          {item.thumb && <img src={item.thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />}
        </div>
        <div className="flex-1 min-w-0 py-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-white/55">Épisode suivant</div>
          {code && <div className="mt-1 text-xs font-medium text-white/70 tabular-nums">{code}</div>}
          <div className="text-sm font-semibold leading-snug line-clamp-2">{item.title}</div>
        </div>
        {!counting && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Masquer l'épisode suivant"
            className="self-start -mr-1 -mt-1 w-8 h-8 rounded-full grid place-items-center text-white/60 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          ref={playRef}
          type="button"
          onClick={onPlay}
          className="relative flex-1 h-11 rounded-xl overflow-hidden bg-white/15 hover:bg-white/20 font-semibold text-sm inline-flex items-center justify-center gap-2 active:scale-[.98] transition"
        >
          {/* Remplissage du compte à rebours */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-[#e5131d]"
            style={{ width: counting ? `${elapsed * 100}%` : "100%", transition: counting ? "width 1s linear" : "none" }}
          />
          <span className="relative inline-flex items-center gap-2 tabular-nums">
            <Play className="w-4 h-4 fill-current" />
            {counting ? `Lecture dans ${secondsLeft} s` : "Lire l'épisode"}
          </span>
        </button>
        {counting && (
          <button
            type="button"
            onClick={onCancel}
            className="h-11 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium active:scale-[.98] transition"
          >
            Annuler
          </button>
        )}
      </div>
      {/* Annoncé une seule fois, pas à chaque seconde */}
      <span className="sr-only" aria-live="polite">
        {counting ? `L'épisode suivant démarre dans ${total} secondes.` : ""}
      </span>
    </div>
  );
};
