import React, { useRef, useState } from "react";
import { ListPlus, ListStart } from "lucide-react";

// Balayage d'une ligne de titre au doigt : vers la droite → ajouter à une playlist, vers la
// gauche → lire ensuite. Écran tactile seulement (souris et clavier ont le menu « ⋮ », qui
// propose les mêmes actions). Le défilement vertical reste celui du navigateur (pan-y).
const THRESHOLD = 76; // px à parcourir pour déclencher l'action
const EDGE = 24; // depuis le bord gauche de l'écran : geste « retour » du système, pas un balayage

type Gesture = { id: number; x: number; y: number; dir: "h" | "v" | null };

export const SwipeRow: React.FC<{
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  children: React.ReactNode;
}> = ({ onSwipeRight, onSwipeLeft, children }) => {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const dxRef = useRef(0);
  const swallowClick = useRef(false);

  const move = (value: number) => {
    // Au-delà du seuil, la ligne résiste : on sent que l'action est armée
    const v = Math.abs(value) <= THRESHOLD ? value : Math.sign(value) * (THRESHOLD + (Math.abs(value) - THRESHOLD) * 0.25);
    if (Math.abs(dxRef.current) < THRESHOLD && Math.abs(v) >= THRESHOLD) navigator.vibrate?.(8);
    dxRef.current = v;
    setDx(v);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || e.clientX < EDGE) return;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dir: null };
    setSettling(false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const mx = e.clientX - g.x;
    const my = e.clientY - g.y;
    if (!g.dir) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      g.dir = Math.abs(mx) > Math.abs(my) * 1.3 ? "h" : "v";
      if (g.dir === "h") {
        e.currentTarget.setPointerCapture(e.pointerId);
        swallowClick.current = true; // le doigt levé ne doit pas lancer le titre
      }
    }
    if (g.dir === "h") move(mx);
  };

  const onPointerEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.dir !== "h") return;
    const v = dxRef.current;
    if (v >= THRESHOLD) onSwipeRight();
    else if (v <= -THRESHOLD) onSwipeLeft();
    if (v !== 0) {
      setSettling(true); // retour animé à sa place
      window.setTimeout(() => setSettling(false), 320);
    }
    dxRef.current = 0;
    setDx(0);
    window.setTimeout(() => (swallowClick.current = false), 300);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    e.stopPropagation();
    e.preventDefault();
  };

  const armed = Math.abs(dx) >= THRESHOLD;
  // Sans décalage, aucun transform : il créerait un contexte d'empilement et le menu « ⋮ »
  // passerait sous les lignes suivantes
  const shifted = dx !== 0 || settling;

  return (
    <div className={`relative rounded-xl ${shifted ? "overflow-hidden" : ""}`}>
      {dx !== 0 && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center text-white ${dx > 0 ? "justify-start bg-accent" : "justify-end bg-[#2f6fe0]"}`}
        >
          {/* Dans la partie découverte (au plus ~90 px) : icône et mot court */}
          <span
            className="w-[76px] flex flex-col items-center gap-1 text-[11px] font-semibold transition-transform duration-150"
            style={{ opacity: Math.min(1, Math.abs(dx) / 48), transform: armed ? "scale(1.1)" : "none" }}
          >
            {dx > 0 ? <ListPlus className="w-5 h-5" strokeWidth={2} /> : <ListStart className="w-5 h-5" strokeWidth={2} />}
            {dx > 0 ? "Playlist" : "Ensuite"}
          </span>
        </div>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        className={shifted ? "relative bg-panel" : ""}
        style={{
          touchAction: "pan-y",
          transform: shifted ? `translateX(${dx}px)` : undefined,
          transition: settling ? "transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1)" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
};
