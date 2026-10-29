import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MediaItem } from "../types";
import { fetchRadio, reportTimeline } from "../api";

export type RepeatMode = "all" | "one" | "off";

interface AudioContextType {
  currentTrack: MediaItem | null;
  isPlaying: boolean;
  queue: MediaItem[];
  queueIndex: number;
  isExpanded: boolean;
  isQueueOpen: boolean;
  volume: number;
  repeatMode: RepeatMode;
  shuffleMode: boolean;
  playTrack: (track: MediaItem, newQueue?: MediaItem[], startIndex?: number) => void;
  pauseTrack: () => void;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  seekBy: (delta: number) => void;
  nextTrack: () => void;
  previousTrack: () => void;
  setIsExpanded: (expanded: boolean) => void;
  setIsQueueOpen: (open: boolean) => void;
  setVolume: (volume: number) => void;
  // File d'attente
  addToQueue: (trackOrTracks: MediaItem | MediaItem[]) => void;
  playNext: (trackOrTracks: MediaItem | MediaItem[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  skipToQueueIndex: (index: number) => void;
  shuffleQueue: () => void;
  toggleRepeatMode: () => void;
  toggleShuffleMode: () => void;
}

// Contextes séparés : la position de lecture change ~4 fois par seconde. Dans le contexte
// principal, elle faisait re-rendre toute l'appli (vue affichée, chaque ligne de titre, jusqu'à
// 805 tuiles d'artistes) pendant toute l'écoute (#31). Seuls les curseurs et les compteurs de
// temps lisent useAudioTime() ; la valeur de useAudio() ne change qu'avec la file ou l'état.
const AudioContext = createContext<AudioContextType | null>(null);
const AudioTimeContext = createContext<{ currentTime: number; duration: number }>({ currentTime: 0, duration: 0 });

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<MediaItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [volume, setVolumeState] = useState(1);
  // Sans répétition, la fin de la file enchaîne sur des titres proches (lecture continue)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffleMode, setShuffleMode] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<MediaItem[]>([]);
  const queueIndexRef = useRef<number>(0);
  const currentTrackRef = useRef<MediaItem | null>(null);
  const repeatModeRef = useRef<RepeatMode>("off");
  const reportIntervalRef = useRef<number | null>(null);
  const radioRef = useRef<Promise<boolean> | null>(null);

  // Synchronisation des refs avec le state pour éviter tout problème de fermeture (stale closure)
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    queueIndexRef.current = queueIndex;
  }, [queueIndex]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  // Jouer une piste directement à un index de la file actuelle
  const playAtIndex = useCallback((targetIndex: number) => {
    const q = queueRef.current;
    if (targetIndex < 0 || targetIndex >= q.length) return;
    const track = q[targetIndex];

    setQueueIndex(targetIndex);
    queueIndexRef.current = targetIndex;
    setCurrentTrack(track);
    currentTrackRef.current = track;

    if (audioRef.current) {
      const streamUrl = track.streamUrl || `/api/stream/audio?key=${encodeURIComponent(track.partKey || "")}`;
      audioRef.current.src = streamUrl;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
        console.warn("Échec autoplay audio :", err);
      });
    }
  }, []);

  // Lecture continue (#24) : des titres proches du dernier de la file sont ajoutés à sa suite,
  // marqués « autoplay ». Résout à true si des titres ont été ajoutés.
  const extendWithRadio = useCallback((): Promise<boolean> => {
    if (radioRef.current) return radioRef.current;
    const q = queueRef.current;
    const seed = q[q.length - 1];
    if (!seed) return Promise.resolve(false);
    const request = fetchRadio(seed.id, q.slice(-300).map((t) => t.id))
      .then((tracks) => {
        const current = queueRef.current;
        // Une autre file a été lancée entre-temps : ces titres ne la concernent pas
        if (!tracks.length || current[current.length - 1]?.id !== seed.id) return false;
        const updated = [...current, ...tracks.map((t) => ({ ...t, autoplay: true }))];
        setQueue(updated);
        queueRef.current = updated;
        return true;
      })
      .catch((err) => {
        console.warn("Lecture continue indisponible :", err);
        return false;
      })
      .finally(() => {
        radioRef.current = null;
      });
    radioRef.current = request;
    return request;
  }, []);

  // Titre suivant ; en fin de file, retour au début si toute la file se répète, sinon lecture
  // continue (jamais de retour silencieux sur le même morceau)
  const advance = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;
    const idx = queueIndexRef.current;
    if (idx + 1 < q.length) return playAtIndex(idx + 1);
    if (repeatModeRef.current === "all") return playAtIndex(0);
    extendWithRadio().then((added) => {
      if (added && queueIndexRef.current === idx) playAtIndex(idx + 1);
    });
  }, [playAtIndex, extendWithRadio]);

  const nextTrack = advance;

  // Initialisation de l'élément Audio et de ses écouteurs
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if ("mediaSession" in navigator && audio.duration && !isNaN(audio.duration)) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          });
        } catch {
          // Ignore
        }
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    };
    const handlePause = () => {
      setIsPlaying(false);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    };

    // GESTION CRITIQUE DU PASSAGE AUTOMATIQUE AU TITRE SUIVANT
    const handleEnded = () => {
      const q = queueRef.current;
      const idx = queueIndexRef.current;
      const repeat = repeatModeRef.current;

      if (repeat === "one") {
        audio.currentTime = 0;
        audio.play().catch(console.error);
        return;
      }

      if (q.length === 0 || idx < 0) return;
      advance();
    };

    // Tolérance aux pannes réseau : passer automatiquement au morceau suivant après 400ms si erreur
    // de flux, mais pas indéfiniment (serveur injoignable : chaque titre échouerait à son tour)
    let errorStreak = 0;
    const handleError = () => {
      console.warn("Erreur de lecture audio, tentative de reprise sur la piste suivante…");
      if (++errorStreak <= 5) window.setTimeout(advance, 400);
    };
    const handlePlaying = () => {
      errorStreak = 0;
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("error", handleError);
    audio.addEventListener("playing", handlePlaying);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("playing", handlePlaying);
    };
  }, [advance]);

  // Dernier titre de la file entamé : la suite est préparée à l'avance (visible dans « À suivre »)
  useEffect(() => {
    if (!currentTrack || repeatMode !== "off") return;
    if (queueRef.current.length - 1 - queueIndexRef.current <= 0) extendWithRadio();
  }, [currentTrack, repeatMode, extendWithRadio]);

  // Configuration MediaSession (CarPlay, Android Auto, Écran de verrouillage iOS)
  useEffect(() => {
    if (!currentTrack || !("mediaSession" in navigator)) return;

    // Artwork en JPEG explicite : iOS/CarPlay affiche le WebP de façon inconstante,
    // et le type déclaré ci-dessous (image/jpeg) doit correspondre au format réel.
    const rawThumb = currentTrack.thumb ? `${window.location.origin}${currentTrack.thumb}` : null;
    const artworkUrl = rawThumb
      ? `${rawThumb}${rawThumb.includes("?") ? "&" : "?"}format=jpeg`
      : `${window.location.origin}/icon.svg`;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.grandparentTitle || currentTrack.parentTitle || "Artiste",
      album: currentTrack.parentTitle || currentTrack.title,
      artwork: [
        { src: artworkUrl, sizes: "96x96", type: "image/jpeg" },
        { src: artworkUrl, sizes: "128x128", type: "image/jpeg" },
        { src: artworkUrl, sizes: "192x192", type: "image/jpeg" },
        { src: artworkUrl, sizes: "256x256", type: "image/jpeg" },
        { src: artworkUrl, sizes: "512x512", type: "image/jpeg" },
      ],
    });

    navigator.mediaSession.setActionHandler("play", () => {
      audioRef.current?.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audioRef.current?.pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      previousTrack();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      nextTrack();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined && audioRef.current) {
        audioRef.current.currentTime = details.seekTime;
      }
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
      }
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.min(audioRef.current.duration, audioRef.current.currentTime + 10);
      }
    });

    // Scrobble Plex régulier (toutes les 10s)
    if (reportIntervalRef.current) clearInterval(reportIntervalRef.current);
    reportIntervalRef.current = window.setInterval(() => {
      if (audioRef.current && !audioRef.current.paused && currentTrack) {
        reportTimeline({
          ratingKey: currentTrack.id,
          key: currentTrack.key,
          state: "playing",
          time: audioRef.current.currentTime * 1000,
          duration: (audioRef.current.duration || currentTrack.duration / 1000) * 1000,
        });
      }
    }, 10000);

    return () => {
      if (reportIntervalRef.current) clearInterval(reportIntervalRef.current);
    };
  }, [currentTrack, nextTrack]);

  // Lancement d'un titre
  const playTrack = useCallback((track: MediaItem, newQueue?: MediaItem[], startIndex?: number) => {
    if (!audioRef.current) return;

    if (newQueue && newQueue.length > 0) {
      setQueue(newQueue);
      queueRef.current = newQueue;
      const idx =
        startIndex !== undefined && startIndex >= 0
          ? startIndex
          : newQueue.findIndex((t) => t.id === track.id);
      const resolved = idx >= 0 ? idx : 0;
      setQueueIndex(resolved);
      queueIndexRef.current = resolved;
    } else if (queueRef.current.length === 0) {
      setQueue([track]);
      queueRef.current = [track];
      setQueueIndex(0);
      queueIndexRef.current = 0;
    } else {
      // Si une file existe déjà, vérifier si le morceau est dedans
      const existIdx = queueRef.current.findIndex((t) => t.id === track.id);
      if (existIdx >= 0) {
        setQueueIndex(existIdx);
        queueIndexRef.current = existIdx;
      } else {
        // Insérer juste après le morceau actuel et le jouer
        const cur = queueIndexRef.current;
        const updated = [...queueRef.current];
        updated.splice(cur + 1, 0, track);
        setQueue(updated);
        queueRef.current = updated;
        setQueueIndex(cur + 1);
        queueIndexRef.current = cur + 1;
      }
    }

    setCurrentTrack(track);
    currentTrackRef.current = track;

    const streamUrl = track.streamUrl || `/api/stream/audio?key=${encodeURIComponent(track.partKey || "")}`;
    audioRef.current.src = streamUrl;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch((err) => console.log("Audio autoplay prevented:", err));
  }, []);

  const pauseTrack = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
    } else {
      audio.play().catch((e) => console.log(e));
    }
  }, []);

  const setVolume = useCallback((value: number) => {
    const v = Math.min(1, Math.max(0, value));
    if (audioRef.current) audioRef.current.volume = v;
    setVolumeState(v);
  }, []);

  const seek = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  // Avance ou recul relatif (boutons ±15 s), sans que l'appelant ait à lire la position
  const seekBy = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const end = isFinite(audio.duration) ? audio.duration : Infinity;
      seek(Math.min(end, Math.max(0, audio.currentTime + delta)));
    },
    [seek]
  );

  const previousTrack = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;
    // Si on a écouté plus de 3 secondes, revenir au début de la piste
    if (audioRef.current && audioRef.current.currentTime > 3) {
      seek(0);
      return;
    }
    const prevIdx = (queueIndexRef.current - 1 + q.length) % q.length;
    playAtIndex(prevIdx);
  }, [seek, playAtIndex]);

  // --- Gestion de la file d'attente (Queue) ---

  const addToQueue = useCallback((trackOrTracks: MediaItem | MediaItem[]) => {
    const tracksToAdd = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
    if (tracksToAdd.length === 0) return;

    if (queueRef.current.length === 0 || !currentTrackRef.current) {
      // Si rien n'est en cours, lancer le premier morceau avec toute la liste en file
      playTrack(tracksToAdd[0], tracksToAdd, 0);
      return;
    }

    // Avant les titres de la lecture continue : ce que l'on ajoute soi-même passe en premier
    const q = queueRef.current;
    const cur = queueIndexRef.current;
    const firstAuto = q.findIndex((t, i) => i > cur && t.autoplay);
    const at = firstAuto >= 0 ? firstAuto : q.length;
    const updated = [...q.slice(0, at), ...tracksToAdd, ...q.slice(at)];
    setQueue(updated);
    queueRef.current = updated;
  }, [playTrack]);

  const playNext = useCallback((trackOrTracks: MediaItem | MediaItem[]) => {
    const tracksToAdd = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
    if (tracksToAdd.length === 0) return;

    if (queueRef.current.length === 0 || !currentTrackRef.current) {
      playTrack(tracksToAdd[0], tracksToAdd, 0);
      return;
    }

    const cur = queueIndexRef.current;
    const updated = [...queueRef.current];
    updated.splice(cur + 1, 0, ...tracksToAdd);
    setQueue(updated);
    queueRef.current = updated;
  }, [playTrack]);

  const removeFromQueue = useCallback((index: number) => {
    const q = queueRef.current;
    if (index < 0 || index >= q.length) return;

    const cur = queueIndexRef.current;
    const updated = q.filter((_, i) => i !== index);

    if (updated.length === 0) {
      setQueue([]);
      queueRef.current = [];
      setQueueIndex(0);
      queueIndexRef.current = 0;
      setCurrentTrack(null);
      currentTrackRef.current = null;
      if (audioRef.current) audioRef.current.pause();
      return;
    }

    if (index === cur) {
      // Si on supprime la piste en cours de lecture, passer à la suivante
      const nextIdx = index < updated.length ? index : 0;
      setQueue(updated);
      queueRef.current = updated;
      playAtIndex(nextIdx);
    } else {
      const nextCur = index < cur ? cur - 1 : cur;
      setQueue(updated);
      queueRef.current = updated;
      setQueueIndex(nextCur);
      queueIndexRef.current = nextCur;
    }
  }, [playAtIndex]);

  const clearQueue = useCallback(() => {
    const curTrack = currentTrackRef.current;
    if (!curTrack) {
      setQueue([]);
      queueRef.current = [];
      setQueueIndex(0);
      return;
    }
    // Ne conserver que la piste en cours
    setQueue([curTrack]);
    queueRef.current = [curTrack];
    setQueueIndex(0);
    queueIndexRef.current = 0;
  }, []);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    const q = queueRef.current;
    if (fromIndex < 0 || fromIndex >= q.length || toIndex < 0 || toIndex >= q.length) return;

    const updated = [...q];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);

    const cur = queueIndexRef.current;
    let newCur = cur;
    if (cur === fromIndex) {
      newCur = toIndex;
    } else if (fromIndex < cur && toIndex >= cur) {
      newCur = cur - 1;
    } else if (fromIndex > cur && toIndex <= cur) {
      newCur = cur + 1;
    }

    setQueue(updated);
    queueRef.current = updated;
    setQueueIndex(newCur);
    queueIndexRef.current = newCur;
  }, []);

  const skipToQueueIndex = useCallback((index: number) => {
    playAtIndex(index);
  }, [playAtIndex]);

  const shuffleQueue = useCallback(() => {
    const q = queueRef.current;
    const cur = queueIndexRef.current;
    if (q.length <= cur + 2) return;

    // Conserver les morceaux passés et le morceau en cours, mélanger la suite
    const pastAndCurrent = q.slice(0, cur + 1);
    const upcoming = q.slice(cur + 1);
    const shuffled = [...upcoming].sort(() => Math.random() - 0.5);

    const updated = [...pastAndCurrent, ...shuffled];
    setQueue(updated);
    queueRef.current = updated;
  }, []);

  // Désactivée (lecture continue) → toute la file → ce titre
  const toggleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      if (prev === "off") return "all";
      if (prev === "all") return "one";
      return "off";
    });
  }, []);

  const toggleShuffleMode = useCallback(() => {
    setShuffleMode((prev) => {
      const next = !prev;
      if (next) shuffleQueue();
      return next;
    });
  }, [shuffleQueue]);

  const value = useMemo(
    () => ({
      currentTrack,
      isPlaying,
      queue,
      queueIndex,
      isExpanded,
      isQueueOpen,
      volume,
      repeatMode,
      shuffleMode,
      playTrack,
      pauseTrack,
      togglePlay,
      seek,
      seekBy,
      nextTrack,
      previousTrack,
      setIsExpanded,
      setIsQueueOpen,
      setVolume,
      addToQueue,
      playNext,
      removeFromQueue,
      clearQueue,
      reorderQueue,
      skipToQueueIndex,
      shuffleQueue,
      toggleRepeatMode,
      toggleShuffleMode,
    }),
    [
      currentTrack,
      isPlaying,
      queue,
      queueIndex,
      isExpanded,
      isQueueOpen,
      volume,
      repeatMode,
      shuffleMode,
      playTrack,
      pauseTrack,
      togglePlay,
      seek,
      seekBy,
      nextTrack,
      previousTrack,
      setVolume,
      addToQueue,
      playNext,
      removeFromQueue,
      clearQueue,
      reorderQueue,
      skipToQueueIndex,
      shuffleQueue,
      toggleRepeatMode,
      toggleShuffleMode,
    ]
  );
  const time = useMemo(() => ({ currentTime, duration }), [currentTime, duration]);

  return (
    <AudioContext.Provider value={value}>
      <AudioTimeContext.Provider value={time}>{children}</AudioTimeContext.Provider>
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error("useAudio must be used within an AudioProvider");
  return ctx;
}

// Position et durée du titre en cours : pour les curseurs et compteurs de temps seulement
export function useAudioTime() {
  return useContext(AudioTimeContext);
}
