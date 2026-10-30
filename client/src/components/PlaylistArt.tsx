import React from "react";
import { ListMusic } from "lucide-react";
import { MediaItem } from "../types";

interface PlaylistArtProps {
  tracks?: MediaItem[];
  images?: string[]; // pochettes déjà choisies (mosaïque d'un genre)
  className?: string;
  round?: boolean;
}

export const PlaylistArt: React.FC<PlaylistArtProps> = ({ tracks = [], images, className = "", round }) => {
  // Récupérer les jaquettes valides uniques
  const thumbs = (images ?? tracks.map((t) => t.thumb || t.parentThumb))
    .filter((src): src is string => Boolean(src));

  // 1. Si au moins 4 jaquettes différentes, faire un collage 2x2
  if (thumbs.length >= 4) {
    const [c1, c2, c3, c4] = thumbs.slice(0, 4);
    return (
      <div
        className={`grid grid-cols-2 grid-rows-2 overflow-hidden bg-surface2 shadow-[0_16px_36px_-12px_rgba(0,0,0,.5)] ${
          round ? "rounded-full" : "rounded-2xl"
        } ${className}`}
      >
        <img src={c1} alt="" className="w-full h-full object-cover" />
        <img src={c2} alt="" className="w-full h-full object-cover" />
        <img src={c3} alt="" className="w-full h-full object-cover" />
        <img src={c4} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }

  // 2. Si au moins 1 jaquette
  if (thumbs.length > 0) {
    return (
      <img
        src={thumbs[0]}
        alt=""
        loading="lazy"
        className={`object-cover bg-surface2 shadow-[0_16px_36px_-12px_rgba(0,0,0,.5)] ${
          round ? "rounded-full" : "rounded-2xl"
        } ${className}`}
      />
    );
  }

  // 3. Si playlist vide : dégradé Rubis avec icône musique
  return (
    <div
      className={`bg-gradient-to-br from-[#e5131d] to-[#450508] grid place-items-center shadow-[0_16px_36px_-12px_rgba(229,19,29,.4)] ${
        round ? "rounded-full" : "rounded-2xl"
      } ${className}`}
    >
      <ListMusic className="w-1/2 h-1/2 text-white/90" strokeWidth={1.8} />
    </div>
  );
};
