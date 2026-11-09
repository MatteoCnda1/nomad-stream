import React, { useState } from "react";
import { CircleArrowDown } from "lucide-react";
import { Playlist } from "../types";
import { useMusicDownloads } from "../context/MusicDownloadsContext";
import { usePlaylist } from "../context/PlaylistContext";

// Bouton « Télécharger » d'une playlist : anneau de progression pendant le téléchargement,
// pastille pleine une fois la playlist sur l'appareil. Un nouvel appui propose de la retirer.
export const PlaylistDownloadButton: React.FC<{ playlist: Playlist }> = ({ playlist }) => {
  const { supported, reason, statusOf, enable, disable } = useMusicDownloads();
  const { showToast } = usePlaylist();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const status = statusOf(playlist);
  const progress = status.total ? status.done / status.total : 0;

  const onClick = () => {
    if (!supported) return showToast(reason || "Téléchargement impossible sur cet appareil");
    if (status.enabled) return setConfirmRemove(true);
    if (status.total === 0) return showToast("Aucun titre à télécharger");
    enable(playlist.id);
    showToast(`Téléchargement de « ${playlist.title} »`);
  };

  const label = !status.enabled
    ? "Télécharger la playlist"
    : status.active
    ? `Téléchargement : ${status.done} sur ${status.total}. Retirer de l'appareil`
    : "Playlist téléchargée. Retirer de l'appareil";

  // Anneau : 20 de rayon dans une boîte de 44
  const R = 19;
  const C = 2 * Math.PI * R;

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        aria-pressed={status.enabled}
        className={`press relative w-11 h-11 rounded-full grid place-items-center hover:bg-card ${
          status.enabled ? "text-accent" : "text-muted hover:text-fg"
        }`}
      >
        {status.enabled && status.active ? (
          <>
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r={R} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
              <circle
                cx="22"
                cy="22"
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - progress)}
                className="transition-[stroke-dashoffset] duration-500"
              />
            </svg>
            <span className="text-[10px] font-bold tabular-nums">{Math.round(progress * 100)}</span>
          </>
        ) : status.enabled ? (
          <span className="w-6 h-6 rounded-full bg-accent text-white grid place-items-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </span>
        ) : (
          <CircleArrowDown className="w-6 h-6" strokeWidth={1.7} />
        )}
      </button>

      {confirmRemove && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="remove-download-title"
          aria-describedby="remove-download-desc"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 anim-in"
          onClick={() => setConfirmRemove(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-surface p-6 border border-line shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="remove-download-title" className="text-lg font-bold text-fg">
              Retirer des téléchargements ?
            </h2>
            <p id="remove-download-desc" className="mt-2 text-sm text-muted">
              « {playlist.title} » ne sera plus écoutable sans connexion. La playlist elle-même est gardée.
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="press px-4 h-10 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-surface2"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  disable(playlist.id);
                  setConfirmRemove(false);
                  showToast("Téléchargement retiré de l'appareil");
                }}
                className="press px-5 h-10 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold"
              >
                Retirer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
