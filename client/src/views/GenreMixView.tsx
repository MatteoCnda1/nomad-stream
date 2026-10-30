// Mix d'un genre (#50) : les titres tirés au hasard par la passerelle, à écouter tels quels
// ou à garder comme playlist.
import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, ListPlus } from "lucide-react";
import { GenreMix } from "../types";
import { useAudio } from "../context/AudioContext";
import { useWishlist } from "../context/WishlistContext";
import { usePlaylist } from "../context/PlaylistContext";
import { Sk } from "../components/ui";
import { PlaylistArt } from "../components/PlaylistArt";
import { BigPlayButton, CollectionHeader, MetaDot, TrackListHeader, TrackRow } from "../components/Collection";
import { genreCounts, loadGenreMix, peekGenreMix } from "../components/GenreMixes";

interface GenreMixViewProps {
  genreId: string;
  onBack: () => void;
}

export const GenreMixView: React.FC<GenreMixViewProps> = ({ genreId, onBack }) => {
  const [mix, setMix] = useState<GenreMix | null>(() => peekGenreMix(genreId));
  const [loading, setLoading] = useState(!mix);
  const [error, setError] = useState(false);
  const { playTrack, currentTrack } = useAudio();
  const { isSaved, toggle } = useWishlist();
  const { createPlaylist, showToast } = usePlaylist();

  const load = useCallback(
    (fresh: boolean) => {
      setLoading(true);
      setError(false);
      loadGenreMix(genreId, fresh)
        .then(setMix)
        .catch((e) => {
          console.error(e);
          setError(true);
        })
        .finally(() => setLoading(false));
    },
    [genreId],
  );

  useEffect(() => {
    if (!peekGenreMix(genreId)) load(false);
  }, [genreId, load]);

  if (!mix) {
    return (
      <div className="pt-6" aria-busy={loading}>
        <CollectionHeader onBack={onBack} backLabel="Genres" art={<Sk className="w-[140px] h-[140px] sm:w-[176px] sm:h-[176px] rounded-2xl" />} eyebrow="Mix" title="" />
        {error ? (
          <div role="alert" className="py-12 text-center text-muted">
            <p>Le mix n'a pas pu être préparé. La bibliothèque est peut-être en cours d'indexation.</p>
            <button
              type="button"
              onClick={() => load(false)}
              className="press mt-4 inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" />
              Réessayer
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-2" aria-label="Chargement du mix">
            {Array.from({ length: 8 }, (_, i) => (
              <Sk key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        )}
      </div>
    );
  }

  const { genre, items } = mix;
  const totalMinutes = Math.round(items.reduce((sum, t) => sum + (t.duration || 0), 0) / 60000);

  const saveAsPlaylist = () => {
    const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    const playlist = createPlaylist(`Mix ${genre.name}`, `Tiré le ${date}`, items);
    showToast(`Playlist « ${playlist.title} » créée`);
  };

  return (
    <div className="anim-in">
      <CollectionHeader
        onBack={onBack}
        backLabel="Genres"
        art={<PlaylistArt images={genre.covers} className="w-[140px] h-[140px] sm:w-[176px] sm:h-[176px] flex-shrink-0" />}
        eyebrow="Mix par genre"
        title={genre.name}
        meta={
          <>
            <span>{items.length} {items.length > 1 ? "titres tirés au hasard" : "titre"}</span>
            {totalMinutes > 0 && <><MetaDot /><span>{totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min` : `${totalMinutes} min`}</span></>}
            <MetaDot />
            <span>sur {genreCounts(genre)}</span>
          </>
        }
      />

      <div className="flex items-center gap-2.5 sm:gap-3">
        <BigPlayButton onClick={() => playTrack(items[0], items, 0)} label={`Écouter le mix ${genre.name}`} disabled={items.length === 0} />
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          aria-label="Nouveau tirage"
          title="Nouveau tirage"
          className="press inline-flex items-center gap-2 h-11 px-4 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-card disabled:opacity-40"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.9} />
          <span className="hidden sm:inline">Nouveau tirage</span>
        </button>
        <button
          type="button"
          onClick={saveAsPlaylist}
          disabled={items.length === 0}
          aria-label="Enregistrer comme playlist"
          title="Enregistrer comme playlist"
          className="press inline-flex items-center gap-2 h-11 px-4 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-card disabled:opacity-40"
        >
          <ListPlus className="w-5 h-5" strokeWidth={1.9} />
          <span className="hidden sm:inline">Enregistrer comme playlist</span>
        </button>
      </div>

      <div className={`mt-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
        <TrackListHeader />
        <div className="mt-2 flex flex-col gap-0.5">
          {items.map((track, idx) => (
            <TrackRow
              key={track.id}
              track={track}
              index={idx}
              isCurrent={currentTrack?.id === track.id}
              saved={isSaved(track.id)}
              onPlay={() => playTrack(track, items, idx)}
              onToggleSaved={() => toggle(track)}
              subtitle={[track.grandparentTitle, track.parentTitle].filter(Boolean).join(" · ")}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
