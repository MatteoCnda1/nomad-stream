import React, { useState } from "react";
import { useAudio, useAudioTime } from "../context/AudioContext";
import { useWishlist } from "../context/WishlistContext";
import { usePlaylist } from "../context/PlaylistContext";
import { useTheme } from "../context/ThemeContext";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronDown,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Heart,
  Maximize2,
  ListMusic,
  Shuffle,
  Repeat,
  Repeat1,
  Trash2,
  ChevronUp,
  X,
  ListPlus,
  Plus,
} from "lucide-react";
import { formatClock, formatTrackDuration } from "../utils/format";
import { ThemeToggle } from "./ui";

// Répétition désactivée = lecture continue en fin de file (titres proches)
const REPEAT_LABELS = {
  off: "Répétition désactivée (lecture continue)",
  all: "Répéter la file",
  one: "Répéter ce titre",
} as const;

const HeartButton: React.FC<{
  saved: boolean;
  onClick: () => void;
  size?: number;
  className?: string;
}> = ({ saved, onClick, size = 19, className = "" }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={saved}
    aria-label={saved ? "Retirer de ma liste" : "Ajouter à ma liste"}
    className={`press grid place-items-center flex-shrink-0 ${
      saved ? "text-accent" : "text-muted hover:text-fg"
    } ${className}`}
  >
    <Heart
      style={{ width: size, height: size }}
      strokeWidth={1.9}
      className={`transition-transform duration-300 ${
        saved ? "fill-current scale-110" : ""
      }`}
    />
  </button>
);

// Seuls ces composants lisent la position (mise à jour ~4 fois par seconde) : le reste du
// lecteur, dont la file d'attente, n'est pas redessiné pendant la lecture (#31)
const Scrubber: React.FC = () => {
  const { seek } = useAudio();
  const { currentTime, duration } = useAudioTime();
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <input
      type="range"
      min={0}
      max={duration || 100}
      step={0.1}
      value={currentTime}
      onChange={(e) => seek(parseFloat(e.target.value))}
      aria-label="Position de lecture"
      className="range w-full"
      style={{ "--pct": `${progress}%` } as React.CSSProperties}
    />
  );
};

const Clock: React.FC<{ show: "elapsed" | "total" | "remaining" }> = ({ show }) => {
  const { currentTime, duration } = useAudioTime();
  if (show === "elapsed") return <span>{formatClock(currentTime)}</span>;
  if (show === "total") return <span>{formatClock(duration)}</span>;
  return <span>-{formatClock(Math.max(0, duration - currentTime))}</span>;
};

// Sans transition, et en transform plutôt qu'en largeur : une largeur animée relançait la mise en
// page et le flou du mini-lecteur à chaque image (coûteux avec 805 tuiles d'artistes affichées).
// La barre avance de moins d'un pixel par mise à jour : l'animation ne se voyait pas.
const MiniProgress: React.FC = () => {
  const { currentTime, duration } = useAudioTime();
  return (
    <span
      className="block h-full w-full origin-left bg-accent"
      style={{ transform: `scaleX(${duration > 0 ? Math.min(1, currentTime / duration) : 0})` }}
    />
  );
};

export const AudioPlayer: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    queue,
    queueIndex,
    isExpanded,
    isQueueOpen,
    volume,
    repeatMode,
    shuffleMode,
    togglePlay,
    seekBy,
    nextTrack,
    previousTrack,
    setIsExpanded,
    setIsQueueOpen,
    setVolume,
    skipToQueueIndex,
    removeFromQueue,
    clearQueue,
    reorderQueue,
    shuffleQueue,
    toggleRepeatMode,
    toggleShuffleMode,
  } = useAudio();

  const { isSaved, toggle } = useWishlist();
  const { openPlaylistModal } = usePlaylist();
  const { isDark } = useTheme();

  // Mode d'affichage dans le lecteur plein écran : "player" (pochette) ou "queue" (file d'attente complète)
  const [fullscreenTab, setFullscreenTab] = useState<"player" | "queue">("player");

  if (!currentTrack) return null;

  const albumArt = currentTrack.thumb || currentTrack.parentThumb || "/icon.svg";
  const artist =
    currentTrack.grandparentTitle || currentTrack.parentTitle || "Artiste inconnu";
  const saved = isSaved(currentTrack.id);
  const toggleSaved = () => toggle(currentTrack);

  // Éléments à suivre dans la file
  const upNext = queue.slice(queueIndex + 1);
  const upcomingCount = upNext.length;
  const upcomingDurationMinutes = Math.round(
    upNext.reduce((acc, t) => acc + (t.duration || 0), 0) / 60000
  );

  const scrubber = <Scrubber />;

  return (
    <>
      {!isExpanded && (
        <>
          {/* BARRE LECTEUR (desktop) */}
          <div
            role="region"
            aria-label="Lecteur"
            className="hidden lg:flex sticky bottom-2.5 z-30 mx-2.5 mb-2.5 items-center gap-4 rounded-[22px] bg-glass backdrop-blur-[24px] backdrop-saturate-[1.4] border border-line px-4 py-2.5 shadow-xl"
          >
            {/* Gauche : jaquette, titre, cœur, ajout playlist */}
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label="Ouvrir le lecteur"
                className="flex-shrink-0"
              >
                <img
                  src={albumArt}
                  alt=""
                  className="w-[54px] h-[54px] rounded-[10px] object-cover bg-surface2 shadow-sm"
                />
              </button>
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="min-w-0 text-left"
              >
                <span className="block text-[15px] font-semibold truncate">
                  {currentTrack.title}
                </span>
                <span className="block text-[13px] text-muted truncate">{artist}</span>
              </button>
              <HeartButton saved={saved} onClick={toggleSaved} className="w-9 h-9" />
              <button
                type="button"
                onClick={() => openPlaylistModal(currentTrack)}
                title="Ajouter à une playlist"
                aria-label="Ajouter à une playlist"
                className="press w-9 h-9 grid place-items-center text-muted hover:text-fg rounded-full hover:bg-surface2"
              >
                <ListPlus className="w-[18px] h-[18px]" strokeWidth={1.9} />
              </button>
            </div>

            {/* Centre : contrôles, répétition, aléatoire et curseur de position */}
            <div className="flex-[1.6_1_0] flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleShuffleMode}
                  aria-label="Lecture aléatoire"
                  title="Lecture aléatoire"
                  className={`press w-8 h-8 grid place-items-center rounded-full transition-colors ${
                    shuffleMode ? "text-accent" : "text-muted hover:text-fg"
                  }`}
                >
                  <Shuffle className="w-4 h-4" strokeWidth={1.9} />
                </button>

                <button
                  type="button"
                  onClick={() => seekBy(-15)}
                  aria-label="Reculer de 15 secondes"
                  className="press w-8 h-8 grid place-items-center text-muted hover:text-fg"
                >
                  <RotateCcw className="w-[17px] h-[17px]" strokeWidth={1.9} />
                </button>

                <button
                  type="button"
                  onClick={previousTrack}
                  aria-label="Précédent"
                  className="press w-9 h-9 grid place-items-center text-muted hover:text-fg"
                >
                  <SkipBack className="w-5 h-5 fill-current" />
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? "Pause" : "Lecture"}
                  className="press w-11 h-11 rounded-full bg-fg text-bg grid place-items-center shadow-md"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-[17px] h-[17px] fill-current ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={nextTrack}
                  aria-label="Suivant"
                  className="press w-9 h-9 grid place-items-center text-muted hover:text-fg"
                >
                  <SkipForward className="w-5 h-5 fill-current" />
                </button>

                <button
                  type="button"
                  onClick={() => seekBy(15)}
                  aria-label="Avancer de 15 secondes"
                  className="press w-8 h-8 grid place-items-center text-muted hover:text-fg"
                >
                  <RotateCw className="w-[17px] h-[17px]" strokeWidth={1.9} />
                </button>

                <button
                  type="button"
                  onClick={toggleRepeatMode}
                  aria-label={REPEAT_LABELS[repeatMode]}
                  title={REPEAT_LABELS[repeatMode]}
                  className={`press w-8 h-8 grid place-items-center rounded-full transition-colors ${
                    repeatMode !== "off" ? "text-accent" : "text-muted hover:text-fg"
                  }`}
                >
                  {repeatMode === "one" ? (
                    <Repeat1 className="w-4 h-4" strokeWidth={2} />
                  ) : (
                    <Repeat className="w-4 h-4" strokeWidth={1.9} />
                  )}
                </button>
              </div>

              <div className="w-full max-w-[560px] flex items-center gap-2.5 text-xs text-muted tabular-nums">
                <Clock show="elapsed" />
                {scrubber}
                <Clock show="total" />
              </div>
            </div>

            {/* Droite : bouton File d'attente, volume, plein écran */}
            <div className="flex-1 hidden xl:flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setIsQueueOpen(!isQueueOpen)}
                aria-label="File d'attente"
                title="File d'attente"
                className={`press relative px-3 h-[38px] rounded-full inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                  isQueueOpen
                    ? "bg-accent text-white"
                    : "text-muted hover:text-fg hover:bg-surface2"
                }`}
              >
                <ListMusic className="w-[17px] h-[17px]" strokeWidth={2} />
                <span>File</span>
                {upcomingCount > 0 && (
                  <span
                    className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                      isQueueOpen ? "bg-white/20 text-white" : "bg-card text-muted"
                    }`}
                  >
                    {upcomingCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label="Lecteur plein écran"
                className="press w-[38px] h-[38px] grid place-items-center text-muted hover:text-fg rounded-full hover:bg-surface2"
              >
                <Maximize2 className="w-[17px] h-[17px]" strokeWidth={1.9} />
              </button>

              <button
                type="button"
                onClick={() => setVolume(volume > 0 ? 0 : 1)}
                aria-label={volume > 0 ? "Couper le son" : "Rétablir le son"}
                className="press ml-1 w-[38px] h-[38px] grid place-items-center text-muted hover:text-fg"
              >
                {volume > 0 ? (
                  <Volume2 className="w-[18px] h-[18px]" strokeWidth={1.9} />
                ) : (
                  <VolumeX className="w-[18px] h-[18px]" strokeWidth={1.9} />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                aria-label="Volume"
                className="range w-[90px]"
                style={{ "--pct": `${volume * 100}%` } as React.CSSProperties}
              />
            </div>
          </div>

          {/* PANNEAU FLOTTANT FILE D'ATTENTE (desktop) */}
          {isQueueOpen && (
            <div
              role="region"
              aria-label="File d'attente flottante"
              className="hidden lg:flex fixed bottom-[88px] right-4 z-40 w-[380px] max-h-[520px] rounded-[24px] bg-surface/95 backdrop-blur-[24px] border border-line shadow-2xl p-4 flex-col anim-in"
            >
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <div className="flex items-center gap-2">
                  <ListMusic className="w-5 h-5 text-accent" strokeWidth={2} />
                  <span className="font-bold text-sm">File d'attente</span>
                  <span className="text-xs text-muted">
                    ({upcomingCount} {upcomingCount > 1 ? "titres" : "titre"})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {upcomingCount > 1 && (
                    <button
                      type="button"
                      onClick={shuffleQueue}
                      title="Mélanger la suite"
                      className="press w-8 h-8 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-surface2"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {upcomingCount > 0 && (
                    <button
                      type="button"
                      onClick={clearQueue}
                      title="Vider la suite de la file"
                      className="press w-8 h-8 rounded-full grid place-items-center text-muted hover:text-accent hover:bg-surface2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsQueueOpen(false)}
                    className="press w-8 h-8 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-surface2"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Titre en cours */}
              <div className="py-2.5 border-b border-line flex items-center gap-3">
                <img
                  src={albumArt}
                  alt=""
                  className="w-10 h-10 rounded-lg object-cover bg-surface2"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-accent-text uppercase tracking-wider">
                    En cours de lecture
                  </div>
                  <div className="text-sm font-semibold truncate">{currentTrack.title}</div>
                  <div className="text-xs text-muted truncate">{artist}</div>
                </div>
              </div>

              {/* Liste des titres suivants */}
              <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar py-2 flex flex-col gap-1">
                {upcomingCount === 0 ? (
                  <div className="py-8 text-center text-xs text-muted">
                    Aucun autre titre dans la file.
                    <br />
                    {repeatMode === "off" ? "La lecture continuera avec des titres proches." : "La file reprendra au début."}
                  </div>
                ) : (
                  upNext.map((item, i) => {
                    const actualIdx = queueIndex + 1 + i;
                    return (
                      <div
                        key={`${item.id}-${actualIdx}`}
                        className="group flex items-center gap-2 p-1.5 rounded-xl hover:bg-card transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => skipToQueueIndex(actualIdx)}
                          className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
                        >
                          <img
                            src={item.thumb || item.parentThumb || albumArt}
                            alt=""
                            className="w-9 h-9 rounded-md object-cover bg-surface2 flex-shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold truncate group-hover:text-accent-text">
                              {item.title}
                            </span>
                            <span className="block text-[11px] text-muted truncate">
                              {item.autoplay && "Lecture continue · "}
                              {item.grandparentTitle || item.parentTitle}
                            </span>
                          </span>
                        </button>
                        <span className="text-[11px] text-muted tabular-nums">
                          {formatTrackDuration(item.duration)}
                        </span>
                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                          {i > 0 && (
                            <button
                              type="button"
                              onClick={() => reorderQueue(actualIdx, actualIdx - 1)}
                              title="Monter"
                              className="press w-6 h-6 grid place-items-center text-muted hover:text-fg"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeFromQueue(actualIdx)}
                            title="Retirer de la file"
                            className="press w-6 h-6 grid place-items-center text-muted hover:text-accent"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* MINI-LECTEUR (mobile & tablette), au-dessus du dock */}
          <div
            className="lg:hidden fixed left-3 right-3 sm:left-8 sm:right-8 z-30 flex items-center gap-2.5 pl-2 pr-2.5 py-2 rounded-2xl bg-glass backdrop-blur-[24px] backdrop-saturate-[1.4] border border-line overflow-hidden shadow-lg"
            style={{ bottom: "calc(max(18px, env(safe-area-inset-bottom)) + 74px)" }}
          >
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="flex-1 min-w-0 flex items-center gap-3 text-left"
              aria-label="Ouvrir le lecteur"
            >
              <img
                src={albumArt}
                alt=""
                className="w-[42px] h-[42px] rounded-[9px] object-cover bg-surface2"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate">
                  {currentTrack.title}
                </span>
                <span className="block text-xs text-muted truncate">{artist}</span>
              </span>
            </button>

            <HeartButton saved={saved} onClick={toggleSaved} size={20} className="w-9 h-9" />

            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Lecture"}
              className="press w-10 h-10 grid place-items-center"
            >
              {isPlaying ? (
                <Pause className="w-[18px] h-[18px] fill-current" />
              ) : (
                <Play className="w-[18px] h-[18px] fill-current ml-0.5" />
              )}
            </button>

            <span className="absolute left-2.5 right-2.5 bottom-0 h-0.5 bg-line2">
              <MiniProgress />
            </span>
          </div>
        </>
      )}

      {/* LECTEUR PLEIN ÉCRAN */}
      {isExpanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lecteur"
          className="fixed inset-0 z-50 bg-bg overflow-y-auto no-scrollbar anim-in select-none"
        >
          {/* Lumière d'ambiance tirée de la pochette */}
          <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
            <img
              src={albumArt}
              alt=""
              className="absolute -left-[40%] -top-[10%] w-[180%] h-[70%] object-cover blur-[70px] saturate-[1.4]"
              style={{ opacity: isDark ? 0.55 : 0.35 }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(180deg, transparent 0%, rgb(var(--bg)) 62%)",
              }}
            />
          </div>

          <div className="relative max-w-[460px] mx-auto px-6 pb-12 pt-[max(18px,env(safe-area-inset-top))]">
            {/* Barre haute : Réduire, Titre / Onglets, Bouton file d'attente, ThemeToggle */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                aria-label="Réduire le lecteur"
                className="press w-11 h-11 rounded-full grid place-items-center"
              >
                <ChevronDown className="w-6 h-6" strokeWidth={2} />
              </button>

              <div className="flex-1 min-w-0 flex justify-center">
                <div className="inline-flex p-1 rounded-full bg-surface2/70 border border-line">
                  <button
                    type="button"
                    onClick={() => setFullscreenTab("player")}
                    className={`press px-3.5 h-7 rounded-full text-xs font-semibold transition-colors ${
                      fullscreenTab === "player"
                        ? "bg-fg text-bg shadow-sm"
                        : "text-muted hover:text-fg"
                    }`}
                  >
                    Lecteur
                  </button>
                  <button
                    type="button"
                    onClick={() => setFullscreenTab("queue")}
                    className={`press px-3.5 h-7 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                      fullscreenTab === "queue"
                        ? "bg-fg text-bg shadow-sm"
                        : "text-muted hover:text-fg"
                    }`}
                  >
                    <span>File</span>
                    {upcomingCount > 0 && (
                      <span className="opacity-80">({upcomingCount})</span>
                    )}
                  </button>
                </div>
              </div>

              <ThemeToggle />
            </div>

            {fullscreenTab === "player" ? (
              <>
                {/* Pochette de l'album avec animation douce de lecture */}
                <img
                  src={albumArt}
                  alt={`Pochette de ${currentTrack.parentTitle || currentTrack.title}`}
                  className={`mt-7 mx-auto w-full max-w-[342px] aspect-square rounded-[26px] object-cover bg-surface2 shadow-[0_40px_70px_-30px_rgba(0,0,0,.65)] transition-transform duration-[600ms] ease-out ${
                    isPlaying ? "" : "scale-[.92]"
                  }`}
                />

                {/* Titre, Artiste, Bouton Playlist & Bouton Cœur */}
                <div className="mt-[30px] flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <h1 className="text-[26px] font-bold tracking-[-0.025em] truncate">
                      {currentTrack.title}
                    </h1>
                    <div className="mt-1 text-base text-muted truncate">
                      {artist}
                      {currentTrack.parentTitle ? ` · ${currentTrack.parentTitle}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openPlaylistModal(currentTrack)}
                    title="Ajouter à une playlist"
                    aria-label="Ajouter à une playlist"
                    className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-surface2"
                  >
                    <ListPlus className="w-6 h-6" strokeWidth={1.9} />
                  </button>
                  <HeartButton
                    saved={saved}
                    onClick={toggleSaved}
                    size={26}
                    className="w-[46px] h-[46px]"
                  />
                </div>

                {/* Scrubber / curseur temporel */}
                <div className="mt-[22px]">
                  {scrubber}
                  <div className="mt-2.5 flex justify-between text-xs text-muted tabular-nums">
                    <Clock show="elapsed" />
                    <Clock show="remaining" />
                  </div>
                </div>

                {/* Contrôles de lecture complets */}
                <div className="mt-3.5 flex items-center justify-between">
                  {/* Aléatoire */}
                  <button
                    type="button"
                    onClick={toggleShuffleMode}
                    aria-label="Lecture aléatoire"
                    className={`press w-[44px] h-[44px] grid place-items-center rounded-full transition-colors ${
                      shuffleMode ? "text-accent" : "text-muted hover:text-fg"
                    }`}
                  >
                    <Shuffle className="w-5 h-5" strokeWidth={1.9} />
                  </button>

                  {/* Recul 15s */}
                  <button
                    type="button"
                    onClick={() => seekBy(-15)}
                    aria-label="Reculer de 15 secondes"
                    className="press w-[44px] h-[44px] grid place-items-center text-muted hover:text-fg"
                  >
                    <RotateCcw className="w-5 h-5" strokeWidth={1.9} />
                  </button>

                  {/* Précédent */}
                  <button
                    type="button"
                    onClick={previousTrack}
                    aria-label="Précédent"
                    className="press w-[52px] h-[52px] grid place-items-center"
                  >
                    <SkipBack className="w-[28px] h-[28px] fill-current" />
                  </button>

                  {/* Bouton central Lecture / Pause */}
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={isPlaying ? "Pause" : "Lecture"}
                    className="press w-[76px] h-[76px] rounded-full bg-accent text-white grid place-items-center shadow-[0_18px_36px_-12px_rgba(229,19,29,.7)]"
                  >
                    {isPlaying ? (
                      <Pause className="w-[26px] h-[26px] fill-current" />
                    ) : (
                      <Play className="w-7 h-7 fill-current ml-1" />
                    )}
                  </button>

                  {/* Suivant */}
                  <button
                    type="button"
                    onClick={nextTrack}
                    aria-label="Suivant"
                    className="press w-[52px] h-[52px] grid place-items-center"
                  >
                    <SkipForward className="w-[28px] h-[28px] fill-current" />
                  </button>

                  {/* Avance 15s */}
                  <button
                    type="button"
                    onClick={() => seekBy(15)}
                    aria-label="Avancer de 15 secondes"
                    className="press w-[44px] h-[44px] grid place-items-center text-muted hover:text-fg"
                  >
                    <RotateCw className="w-5 h-5" strokeWidth={1.9} />
                  </button>

                  {/* Répétition */}
                  <button
                    type="button"
                    onClick={toggleRepeatMode}
                    aria-label={REPEAT_LABELS[repeatMode]}
                    title={REPEAT_LABELS[repeatMode]}
                    className={`press w-[44px] h-[44px] grid place-items-center rounded-full transition-colors ${
                      repeatMode !== "off" ? "text-accent" : "text-muted hover:text-fg"
                    }`}
                  >
                    {repeatMode === "one" ? (
                      <Repeat1 className="w-5 h-5" strokeWidth={2} />
                    ) : (
                      <Repeat className="w-5 h-5" strokeWidth={1.9} />
                    )}
                  </button>
                </div>

                {/* Aperçu À suivre */}
                {upcomingCount > 0 && (
                  <section aria-label="À suivre" className="mt-8 rounded-3xl bg-surface p-[18px]">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h2 className="text-[15px] font-semibold">À suivre</h2>
                        <span className="text-xs text-muted">
                          {upcomingCount} titres · {upcomingDurationMinutes} min
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFullscreenTab("queue")}
                        className="text-xs font-semibold text-accent-text hover:underline"
                      >
                        Voir tout
                      </button>
                    </div>

                    <div className="flex flex-col gap-1">
                      {upNext.slice(0, 5).map((item, i) => {
                        const actualIdx = queueIndex + 1 + i;
                        return (
                          <button
                            key={`${item.id}-${actualIdx}`}
                            type="button"
                            onClick={() => skipToQueueIndex(actualIdx)}
                            className="w-full flex items-center gap-3 py-2 text-left hover:bg-card px-2 rounded-xl transition-colors"
                          >
                            <img
                              src={item.thumb || item.parentThumb || albumArt}
                              alt=""
                              loading="lazy"
                              className="w-10 h-10 rounded-[8px] object-cover bg-surface2 flex-shrink-0"
                            />
                            <span className="flex-1 min-w-0">
                              <span className="block text-[14px] font-semibold truncate">
                                {item.title}
                              </span>
                              <span className="block text-xs text-muted truncate">
                                {item.autoplay && "Lecture continue · "}
                              {item.grandparentTitle || item.parentTitle}
                              </span>
                            </span>
                            <span className="text-xs text-muted tabular-nums">
                              {formatTrackDuration(item.duration)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            ) : (
              /* VUE COMPLÈTE FILE D'ATTENTE DANS LE LECTEUR PLEIN ÉCRAN */
              <div className="mt-6 anim-in">
                {/* En-tête de file */}
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div>
                    <h2 className="text-xl font-bold">File d'attente</h2>
                    <p className="text-xs text-muted">
                      {upcomingCount} titres à suivre · {upcomingDurationMinutes} min
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {upcomingCount > 1 && (
                      <button
                        type="button"
                        onClick={shuffleQueue}
                        className="press px-3 h-8 rounded-full bg-surface2 text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>Mélanger</span>
                      </button>
                    )}
                    {upcomingCount > 0 && (
                      <button
                        type="button"
                        onClick={clearQueue}
                        className="press px-3 h-8 rounded-full bg-surface2 hover:text-accent text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Vider</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Morceau actuellement en lecture */}
                <div className="my-4 p-3.5 rounded-2xl bg-surface border border-line flex items-center gap-3">
                  <img
                    src={albumArt}
                    alt=""
                    className="w-12 h-12 rounded-xl object-cover bg-surface2"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-bold text-accent-text uppercase tracking-wider block">
                      En cours de lecture
                    </span>
                    <span className="text-[15px] font-semibold truncate block">
                      {currentTrack.title}
                    </span>
                    <span className="text-xs text-muted truncate block">{artist}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openPlaylistModal(currentTrack)}
                    title="Ajouter à une playlist"
                    className="press w-9 h-9 rounded-full grid place-items-center text-muted hover:text-fg"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {/* Liste des titres suivants */}
                <div className="mt-4 flex flex-col gap-1">
                  {upcomingCount === 0 ? (
                    <div className="py-12 text-center text-muted">
                      <ListMusic className="w-12 h-12 mx-auto mb-2 opacity-40" strokeWidth={1.5} />
                      <p className="font-semibold text-sm">Fin de la file</p>
                      <p className="text-xs mt-1">
                        {repeatMode === "off"
                          ? "La lecture continuera avec des titres proches de celui-ci."
                          : "La file reprendra au début."}
                      </p>
                    </div>
                  ) : (
                    upNext.map((item, i) => {
                      const actualIdx = queueIndex + 1 + i;
                      return (
                        <div
                          key={`${item.id}-${actualIdx}`}
                          className="group flex items-center gap-2.5 p-2 rounded-2xl hover:bg-surface transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => skipToQueueIndex(actualIdx)}
                            className="flex-1 min-w-0 flex items-center gap-3 text-left"
                          >
                            <img
                              src={item.thumb || item.parentThumb || albumArt}
                              alt=""
                              className="w-11 h-11 rounded-[10px] object-cover bg-surface2 flex-shrink-0"
                            />
                            <span className="min-w-0">
                              <span className="block text-[14px] font-semibold truncate group-hover:text-accent-text">
                                {item.title}
                              </span>
                              <span className="block text-xs text-muted truncate">
                                {item.autoplay && "Lecture continue · "}
                              {item.grandparentTitle || item.parentTitle}
                              </span>
                            </span>
                          </button>

                          <span className="text-xs text-muted tabular-nums">
                            {formatTrackDuration(item.duration)}
                          </span>

                          <div className="flex items-center gap-1">
                            {i > 0 && (
                              <button
                                type="button"
                                onClick={() => reorderQueue(actualIdx, actualIdx - 1)}
                                title="Monter"
                                className="press w-8 h-8 rounded-full grid place-items-center text-muted hover:text-fg"
                              >
                                <ChevronUp className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openPlaylistModal(item)}
                              title="Ajouter à une playlist"
                              className="press w-8 h-8 rounded-full grid place-items-center text-muted hover:text-fg"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFromQueue(actualIdx)}
                              title="Retirer de la file"
                              className="press w-8 h-8 rounded-full grid place-items-center text-muted hover:text-accent"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
