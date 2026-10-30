import React, { useEffect, useState } from "react";
import { useAudio, useAudioTime } from "../context/AudioContext";
import { MediaItem, MusicGenre } from "../types";
import { fetchHubs, fetchAlbumDetail, fetchMusicGenres } from "../api";
import { loadGenreMix } from "../components/GenreMixes";
import { PlaylistArt } from "../components/PlaylistArt";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Disc3,
  Tv,
  Radio,
  Volume2,
  Shuffle,
} from "lucide-react";

interface CarModeViewProps {
  onPlayMedia: (item: MediaItem) => void;
}

const formatTime = (secs: number) => {
  if (isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

// Seul composant de l'écran à suivre la position de lecture (~4 mises à jour par seconde)
const CarClock: React.FC = () => {
  const { currentTime, duration } = useAudioTime();
  return (
    <div className="flex items-center justify-center gap-2 text-xs tabular-nums text-muted mt-2">
      <span>{formatTime(currentTime)}</span>
      <span>/</span>
      <span>{formatTime(duration)}</span>
    </div>
  );
};

export const CarModeView: React.FC<CarModeViewProps> = ({ onPlayMedia }) => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    previousTrack,
    playTrack,
  } = useAudio();

  const [activeTab, setActiveTab] = useState<"player" | "continue" | "albums" | "mixes">("player");
  const [onDeck, setOnDeck] = useState<MediaItem[]>([]);
  const [recentAlbums, setRecentAlbums] = useState<MediaItem[]>([]);
  const [genres, setGenres] = useState<MusicGenre[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHubs()
      .then((data) => {
        setOnDeck(data.onDeck);
        setRecentAlbums(data.recentMusic);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
    fetchMusicGenres()
      .then(setGenres)
      .catch(() => {});
  }, []);

  // Mix d'un genre (#50) : un appui, un nouveau tirage, et retour au lecteur
  const handlePlayGenre = async (genre: MusicGenre) => {
    try {
      const mix = await loadGenreMix(genre.id, true);
      if (mix.items.length > 0) {
        playTrack(mix.items[0], mix.items);
        setActiveTab("player");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePlayAlbum = async (album: MediaItem) => {
    try {
      const res = await fetchAlbumDetail(album.id);
      if (res.tracks.length > 0) {
        playTrack(res.tracks[0], res.tracks);
        setActiveTab("player");
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-[82vh] flex flex-col justify-between select-none pb-20 anim-in pt-[max(18px,env(safe-area-inset-top))] lg:pt-1">
      <h1 className="sr-only">Mode voiture</h1>
      {/* Mode Car Tabs Header */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2 bg-card p-1.5 rounded-2xl">
        <button
          onClick={() => setActiveTab("player")}
          className={`py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition active:scale-95 ${
            activeTab === "player"
              ? "bg-accent text-white shadow-lg shadow-accent/20"
              : "text-muted hover:text-fg"
          }`}
        >
          <Radio className="w-4 h-4" />
          Lecteur
        </button>

        <button
          onClick={() => setActiveTab("continue")}
          className={`py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition active:scale-95 ${
            activeTab === "continue"
              ? "bg-primary text-white shadow-lg shadow-primary/20"
              : "text-muted hover:text-fg"
          }`}
        >
          <Tv className="w-4 h-4" />
          Continuer ({onDeck.length})
        </button>

        <button
          onClick={() => setActiveTab("albums")}
          className={`py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition active:scale-95 ${
            activeTab === "albums"
              ? "bg-accent text-white shadow-lg shadow-accent/20"
              : "text-muted hover:text-fg"
          }`}
        >
          <Disc3 className="w-4 h-4" />
          Albums
        </button>

        <button
          onClick={() => setActiveTab("mixes")}
          className={`py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 transition active:scale-95 ${
            activeTab === "mixes"
              ? "bg-accent text-white shadow-lg shadow-accent/20"
              : "text-muted hover:text-fg"
          }`}
        >
          <Shuffle className="w-4 h-4" />
          Mixes
        </button>
      </div>

      {/* TAB 1: OVERSIZED CAR PLAYER */}
      {activeTab === "player" && (
        <div className="flex-1 flex flex-col items-center justify-center py-6 space-y-6">
          {currentTrack ? (
            <>
              {/* Giant Artwork */}
              <div className="w-48 h-48 sm:w-60 sm:h-60 rounded-[26px] overflow-hidden shadow-[0_40px_70px_-30px_rgba(0,0,0,.65)] bg-card">
                <img
                  src={currentTrack.thumb || currentTrack.parentThumb || "/icon.svg"}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Title & Artist */}
              <div className="text-center px-4 max-w-lg">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-[-0.025em] truncate">
                  {currentTrack.title}
                </h2>
                <p className="text-base sm:text-lg font-medium text-muted truncate mt-1">
                  {currentTrack.grandparentTitle || currentTrack.parentTitle || "Artiste inconnu"}
                </p>
                <CarClock />
              </div>

              {/* Giant Tactile Controls */}
              <div className="w-full max-w-md flex items-center justify-center gap-6 sm:gap-10 pt-2">
                <button
                  type="button"
                  onClick={previousTrack}
                  aria-label="Titre précédent"
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-card flex items-center justify-center active:bg-surface3 active:scale-90 transition shadow-lg"
                >
                  <SkipBack className="w-8 h-8 sm:w-10 sm:h-10" />
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? "Pause" : "Lecture"}
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-accent text-white flex items-center justify-center active:scale-90 transition shadow-[0_18px_36px_-12px_rgba(229,19,29,.7)]"
                >
                  {isPlaying ? (
                    <Pause className="w-12 h-12 fill-current" />
                  ) : (
                    <Play className="w-12 h-12 fill-current ml-2" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={nextTrack}
                  aria-label="Titre suivant"
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-card flex items-center justify-center active:bg-surface3 active:scale-90 transition shadow-lg"
                >
                  <SkipForward className="w-8 h-8 sm:w-10 sm:h-10" />
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-12 space-y-4">
              <div className="w-20 h-20 rounded-[28px] bg-card flex items-center justify-center mx-auto text-muted">
                <Radio className="w-10 h-10" />
              </div>
              <p className="font-bold text-lg">Aucune piste en lecture</p>
              <p className="text-sm text-muted max-w-xs mx-auto">
                Choisissez un album ou reprenez une série ci-dessus pour lancer la lecture.
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CONTINUE WATCHING / ON DECK (Car-friendly giant list) */}
      {activeTab === "continue" && (
        <div className="flex-1 py-4 space-y-3">
          {onDeck.map((item) => (
            <div
              key={item.id}
              onClick={() => onPlayMedia(item)}
              className="flex items-center gap-4 p-4 rounded-2xl bg-card active:bg-surface3 transition cursor-pointer"
            >
              <div className="relative w-24 h-16 rounded-xl overflow-hidden bg-black flex-shrink-0">
                <img
                  src={item.art || item.thumb || ""}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Play className="w-6 h-6 text-white fill-current" />
                </div>
              </div>
              <div className="truncate flex-1">
                <h3 className="text-base font-bold truncate">{item.title}</h3>
                <p className="text-xs text-muted truncate">
                  {item.parentTitle ? `${item.grandparentTitle || item.parentTitle} • ` : ""}
                  {item.progressPercent}% terminé
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 3: ONE-CLICK ALBUMS */}
      {activeTab === "albums" && (
        <div className="flex-1 py-4 grid grid-cols-2 gap-3">
          {recentAlbums.map((album) => (
            <div
              key={album.id}
              onClick={() => handlePlayAlbum(album)}
              className="p-3.5 rounded-2xl bg-card active:bg-surface3 transition cursor-pointer flex flex-col items-center text-center"
            >
              <div className="w-24 h-24 rounded-xl overflow-hidden mb-2">
                <img
                  src={album.thumb || "/icon.svg"}
                  alt={album.title}
                  className="w-full h-full object-cover"
                />
              </div>
              <h3 className="text-sm font-bold truncate max-w-full">
                {album.title}
              </h3>
              <p className="text-xs text-muted truncate max-w-full">
                {album.parentTitle || "Artiste"}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: MIXES PAR GENRE (un appui = un nouveau mix) */}
      {activeTab === "mixes" && (
        <div className="flex-1 py-4 grid grid-cols-2 gap-3">
          {genres.length === 0 && (
            <p className="col-span-2 py-12 text-center text-muted">Mixes indisponibles pour l'instant.</p>
          )}
          {genres.map((genre) => (
            <button
              type="button"
              key={genre.id}
              onClick={() => handlePlayGenre(genre)}
              aria-label={`Écouter un mix ${genre.name}`}
              className="p-3.5 rounded-2xl bg-card active:bg-surface3 transition flex flex-col items-center text-center"
            >
              <PlaylistArt images={genre.covers} className="w-24 h-24 mb-2" />
              <span className="text-base font-bold truncate max-w-full">{genre.name}</span>
              <span className="text-xs text-muted truncate max-w-full">{genre.trackCount} titres</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
