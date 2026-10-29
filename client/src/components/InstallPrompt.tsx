import React, { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";
import { useInstall } from "../hooks/useInstall";
import { useAudio } from "../context/AudioContext";

// Invite « Ajouter à l'écran d'accueil » (#9), proposée une fois quelques secondes après
// l'ouverture : l'installation n'est pas évidente pour les autres utilisateurs, surtout sur iOS.
// Refusée, elle ne revient pas avant 30 jours (Compte › Application la propose toujours).
const DISMISS_KEY = "nomad-install-dismissed";
const DELAY_MS = 8000;
const SNOOZE_MS = 30 * 24 * 3600 * 1000;

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < SNOOZE_MS;
  } catch {
    return false;
  }
}

// Marche à suivre sur iOS (partagée avec la page Compte)
export const IOSInstallSteps: React.FC<{ className?: string }> = ({ className = "" }) => (
  <ol className={`flex flex-col gap-1.5 text-sm text-muted ${className}`}>
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="whitespace-nowrap">1. Touchez</span>
      <Share className="w-4 h-4 text-fg flex-shrink-0" strokeWidth={2} aria-label="Partager" />
      <span className="whitespace-nowrap">dans Safari</span>
    </li>
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="whitespace-nowrap">2. Choisissez</span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg font-medium">
        <SquarePlus className="w-4 h-4 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
        Sur l'écran d'accueil
      </span>
    </li>
  </ol>
);

export const InstallPrompt: React.FC = () => {
  const { canPrompt, ios, prompt } = useInstall();
  const { currentTrack } = useAudio();
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(dismissedRecently);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (closed || !ready || !(canPrompt || ios)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Stockage indisponible : l'invite reviendra à la prochaine ouverture
    }
    setClosed(true);
  };

  return (
    <aside
      aria-labelledby="install-title"
      className="fixed z-40 left-3 right-3 sm:left-auto sm:right-6 sm:w-[380px] lg:bottom-6 rounded-3xl bg-surface border border-line2 shadow-2xl p-4 anim-in"
      // Au-dessus du dock et du mini-lecteur sur mobile
      style={{ bottom: `calc(max(18px, env(safe-area-inset-bottom)) + ${currentTrack ? 148 : 76}px)` }}
    >
      <div className="flex items-start gap-3.5">
        <img src="/icon-192.png" alt="" className="w-12 h-12 rounded-[14px] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 id="install-title" className="text-[15px] font-semibold">Installer Nomad Stream</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">
            En plein écran comme une appli, depuis l'écran d'accueil.
          </p>
          {ios && !canPrompt && <IOSInstallSteps className="mt-3" />}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fermer"
          className="press -mt-1 -mr-1 w-9 h-9 rounded-full grid place-items-center text-muted hover:text-fg flex-shrink-0"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>
      {canPrompt && (
        <div className="mt-3.5 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="press h-10 px-4 rounded-full text-sm font-semibold text-muted hover:text-fg"
          >
            Plus tard
          </button>
          <button
            type="button"
            onClick={() => prompt().finally(() => setClosed(true))}
            className="press h-10 px-5 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold"
          >
            Installer
          </button>
        </div>
      )}
    </aside>
  );
};
