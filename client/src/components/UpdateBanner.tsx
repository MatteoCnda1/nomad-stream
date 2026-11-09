import React, { useState } from "react";
import { RotateCw, X } from "lucide-react";
import { applyUpdate, useAppUpdate } from "../appUpdate";

// Bannière « Nouvelle version disponible » : actualiser recharge l'appli sur la dernière version.
// Jamais automatique : une lecture en cours serait coupée.
export const UpdateBanner: React.FC = () => {
  const available = useAppUpdate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  if (!available || dismissed === available) return null;

  return (
    // Centrée par le conteneur : l'animation d'entrée (transform) annulerait un translate
    <div
      className="fixed z-[55] inset-x-0 flex justify-center px-4 pointer-events-none"
      style={{ top: "max(12px, env(safe-area-inset-top))" }}
    >
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto w-full max-w-[440px] flex items-center gap-3 pl-4 pr-2 py-2 rounded-2xl bg-surface2 border border-line2 shadow-[0_16px_36px_rgba(0,0,0,.45)] anim-in"
    >
      <span className="flex-1 min-w-0 text-sm font-semibold">Nouvelle version disponible</span>
      <button
        type="button"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          void applyUpdate();
        }}
        className="press h-9 px-4 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
      >
        <RotateCw className={`w-4 h-4 ${reloading ? "animate-spin" : ""}`} strokeWidth={2.2} />
        Actualiser
      </button>
      <button
        type="button"
        onClick={() => setDismissed(available)}
        aria-label="Plus tard"
        className="press w-9 h-9 rounded-full grid place-items-center text-muted hover:text-fg"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
    </div>
  );
};
