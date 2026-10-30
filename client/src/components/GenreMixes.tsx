// Mixes tout faits par genre (#50) : tuile d'un genre (mosaïque de pochettes + bouton Écouter),
// lancement d'un mix, et dernier tirage de chaque genre gardé pendant la session.
import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { GenreMix, MusicGenre } from "../types";
import { fetchGenreMix } from "../api";
import { useAudio } from "../context/AudioContext";
import { usePlaylist } from "../context/PlaylistContext";
import { PlaylistArt } from "./PlaylistArt";
import { PlayGlyph } from "./ui";

// Dernier tirage de chaque genre : rouvrir un mix montre ce qui est en train de jouer, jusqu'au
// prochain « Nouveau tirage »
const lastMixes = new Map<string, GenreMix>();

export const peekGenreMix = (genreId: string) => lastMixes.get(genreId) ?? null;

export async function loadGenreMix(genreId: string, fresh = false): Promise<GenreMix> {
  const kept = lastMixes.get(genreId);
  if (kept && !fresh) return kept;
  const mix = await fetchGenreMix(genreId);
  lastMixes.set(genreId, mix);
  return mix;
}

export const genreCounts = (genre: MusicGenre) =>
  `${genre.trackCount} ${genre.trackCount > 1 ? "titres" : "titre"} · ${genre.artistCount} ${genre.artistCount > 1 ? "artistes" : "artiste"}`;

// Lance un nouveau mix du genre (un tirage différent à chaque fois)
export function usePlayGenre() {
  const { playTrack } = useAudio();
  const { showToast } = usePlaylist();
  return async (genre: MusicGenre) => {
    try {
      const mix = await loadGenreMix(genre.id, true);
      if (mix.items.length === 0) return showToast(`Aucun titre pour « ${genre.name} »`);
      playTrack(mix.items[0], mix.items, 0);
      showToast(`Mix ${genre.name} : ${mix.items.length} titres`);
    } catch (e) {
      console.error(e);
      showToast("Mix indisponible pour l'instant, réessayez dans un instant");
    }
  };
}

// Tuile d'un genre, comme celle d'une playlist : la tuile ouvre le mix, le bouton rouge le lance.
// Les deux boutons sont côte à côte (pas l'un dans l'autre : inaccessible au clavier).
export const GenreTile: React.FC<{
  genre: MusicGenre;
  onOpen: (genre: MusicGenre) => void;
  onPlay: (genre: MusicGenre) => Promise<void>;
}> = ({ genre, onOpen, onPlay }) => {
  const [starting, setStarting] = useState(false);
  const play = async () => {
    if (starting) return;
    setStarting(true);
    await onPlay(genre);
    setStarting(false);
  };
  return (
    <div className="tile relative rounded-2xl group">
      <button type="button" onClick={() => onOpen(genre)} className="block w-full text-left p-2.5 rounded-2xl">
        <PlaylistArt images={genre.covers} className="w-full aspect-square" />
        <div className="mt-3 text-[15px] font-semibold truncate group-hover:text-accent-text transition-colors">
          {genre.name}
        </div>
        <div className="mt-0.5 text-[13px] leading-snug text-muted truncate">{genreCounts(genre)}</div>
      </button>
      {/* Calque de la taille de la pochette : le bouton se pose dans son coin */}
      <div className="pointer-events-none absolute inset-x-2.5 top-2.5 aspect-square">
        <button
          type="button"
          onClick={play}
          aria-label={`Écouter un mix ${genre.name}`}
          aria-busy={starting}
          className="fab fab-action pointer-events-auto absolute right-2.5 bottom-2.5 w-[46px] h-[46px] rounded-full bg-accent grid place-items-center shadow-[0_10px_24px_-6px_rgba(229,19,29,.6)] text-white hover:scale-105 transition-transform"
        >
          {starting ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" />
          ) : (
            <PlayGlyph className="w-[18px] h-[18px] text-white ml-0.5" />
          )}
        </button>
      </div>
    </div>
  );
};
