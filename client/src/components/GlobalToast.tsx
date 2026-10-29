import React from "react";
import { usePlaylist } from "../context/PlaylistContext";
import { CheckCircle2 } from "lucide-react";

export const GlobalToast: React.FC = () => {
  const { toast } = usePlaylist();
  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-50 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-full bg-surface2 text-fg border border-line2 shadow-[0_16px_36px_rgba(0,0,0,.45)] flex items-center gap-2.5 text-sm font-semibold toast pointer-events-none"
      style={{
        bottom: "calc(max(20px, env(safe-area-inset-bottom)) + 74px)",
      }}
    >
      <CheckCircle2 className="w-4 h-4 text-ok flex-shrink-0" strokeWidth={2.2} />
      <span>{toast}</span>
    </div>
  );
};
