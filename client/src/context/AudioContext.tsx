import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MediaItem } from "../types";
import { fetchRadio, reportTimeline } from "../api";
import {
  audioSource,
  forgetPrefetched,
  isPrecharge,
  isPrefetched,
  kickPrefetch,
  setPrefetchGate,
  setPrefetchWanted,
} from "../audioPrefetch";
import { registerAudioElement, resumeEqualizer } from "../equalizer";
import {
  crossfadeSeconds,
  fadeIn,
  fadeOut,
  primeDeck,
  sameAlbumInOrder,
  setLevel,
  setUserVolume,
} from "../crossfade";

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

  // Deux lecteurs pour le fondu enchaîné (#59) : audioRef désigne celui du titre en cours, que
  // suivent l'interface, l'écran verrouillé et le suivi Plex ; l'autre prépare le titre suivant
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const decksRef = useRef<HTMLAudioElement[]>([]);
  const fadeRef = useRef<{ out: HTMLAudioElement; inc: HTMLAudioElement; seconds: number; raf: number } | null>(null);
  const fadeStartingRef = useRef(false); // titre suivant en cours de démarrage pour un fondu
  const fadeGenRef = useRef(0); // un démarrage devenu inutile (geste de l'utilisateur) est abandonné
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

  // --- Fondu enchaîné (#59) ---

  // Termine net le fondu (fin normale, ou geste de l'utilisateur) : l'ancien titre s'arrête, le
  // nouveau passe à plein volume. Un titre suivant en train de démarrer est abandonné.
  const finishFade = useCallback(() => {
    fadeGenRef.current++;
    fadeStartingRef.current = false;
    const f = fadeRef.current;
    if (!f) return;
    fadeRef.current = null;
    cancelAnimationFrame(f.raf);
    f.out.pause();
    f.out.removeAttribute("src");
    f.out.load();
    setLevel(f.out, 1);
    setLevel(f.inc, 1);
  }, []);

  // Volumes croisés selon l'avancée du nouveau titre. Appelé à chaque image quand l'appli est à
  // l'écran, et à chaque `timeupdate` sinon (les animations s'arrêtent en arrière-plan)
  const stepFade = useCallback(() => {
    const f = fadeRef.current;
    if (!f) return;
    const p = f.inc.currentTime / f.seconds;
    if (p >= 1 || f.out.ended) return finishFade();
    setLevel(f.inc, fadeIn(p));
    setLevel(f.out, fadeOut(p));
  }, [finishFade]);

  // Démarre le titre suivant sur l'autre lecteur, à volume nul ; dès qu'il joue, il devient le
  // titre en cours et les volumes se croisent jusqu'à la fin de l'ancien
  const startCrossfade = useCallback(
    (next: MediaItem, nextIndex: number) => {
      const out = audioRef.current;
      const inc = decksRef.current.find((d) => d !== out);
      if (!out || !inc) return;
      fadeStartingRef.current = true;
      const gen = ++fadeGenRef.current;
      const seconds = Math.max(1, Math.min(crossfadeSeconds(), out.duration - out.currentTime));
      setLevel(inc, 0);
      inc.src = audioSource(next);
      inc.currentTime = 0;
      inc
        .play()
        .then(() => {
          if (gen !== fadeGenRef.current || audioRef.current !== out || out.paused) {
            inc.pause();
            inc.removeAttribute("src");
            inc.load();
            setLevel(inc, 1);
            return;
          }
          audioRef.current = inc;
          setQueueIndex(nextIndex);
          queueIndexRef.current = nextIndex;
          setCurrentTrack(next);
          currentTrackRef.current = next;
          setDuration(isFinite(inc.duration) ? inc.duration : next.duration / 1000);
          setCurrentTime(inc.currentTime);
          setIsPlaying(true);
          fadeRef.current = { out, inc, seconds, raf: 0 };
          const loop = () => {
            stepFade();
            if (fadeRef.current?.inc === inc) fadeRef.current.raf = requestAnimationFrame(loop);
          };
          loop();
        })
        .catch((err) => {
          // Démarrage refusé (iPhone : lecteur jamais lancé par un geste) : enchaînement normal à
          // la fin du titre, sans nouvel essai pour celui-ci
          console.warn("Fondu enchaîné impossible :", err);
          if (gen !== fadeGenRef.current) return;
          inc.removeAttribute("src");
          inc.load();
          setLevel(inc, 1);
        });
    },
    [stepFade],
  );

  // Jouer une piste directement à un index de la file actuelle
  const playAtIndex = useCallback((targetIndex: number) => {
    const q = queueRef.current;
    if (targetIndex < 0 || targetIndex >= q.length) return;
    const track = q[targetIndex];
    finishFade();

    setQueueIndex(targetIndex);
    queueIndexRef.current = targetIndex;
    setCurrentTrack(track);
    currentTrackRef.current = track;

    if (audioRef.current) {
      // Copie préchargée (#56) si elle est prête : démarrage sans attendre le réseau
      audioRef.current.src = audioSource(track);
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
        console.warn("Échec autoplay audio :", err);
      });
    }
  }, [finishFade]);

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

  // Initialisation des deux lecteurs et de leurs écouteurs. Les événements de l'autre lecteur
  // (titre qui s'éteint, titre suivant qui démarre) ne touchent pas à l'état du lecteur.
  useEffect(() => {
    const decks = [new Audio(), new Audio()];
    decksRef.current = decks;
    audioRef.current = decks[0];
    decks.forEach(registerAudioElement); // égaliseur : branché à la première lecture s'il est activé

    // Préchargement (#56) : pas tant que le titre en cours, lu en flux, a moins de 30 s d'avance
    // (ou n'est pas chargé jusqu'au bout) : il garde la priorité sur le débit
    setPrefetchGate(() => {
      const audio = audioRef.current;
      if (!audio || !audio.src || isPrecharge(audio.src)) return true;
      const t = audio.currentTime;
      const end = isFinite(audio.duration) ? audio.duration : Infinity;
      for (let i = 0; i < audio.buffered.length; i++) {
        if (audio.buffered.start(i) <= t + 0.5 && audio.buffered.end(i) >= Math.min(t + 30, end - 0.5)) return true;
      }
      return false;
    });

    // Reprend le titre en cours à la même position depuis une autre source
    const resumeFrom = (audio: HTMLAudioElement, src: string, at: number) => {
      audio.src = src;
      audio.addEventListener(
        "loadedmetadata",
        () => {
          audio.currentTime = at;
          audio.play().catch(console.error);
        },
        { once: true },
      );
    };

    // Écouteur réservé au lecteur du titre en cours
    const own = (handler: (audio: HTMLAudioElement) => void) => (e: Event) => {
      if (e.currentTarget === audioRef.current) handler(e.currentTarget as HTMLAudioElement);
    };

    // Fondu enchaîné (#59) : quelques secondes avant la fin, le titre suivant démarre sur l'autre
    // lecteur. Pas de fondu en répétant un titre, ni entre deux titres qui se suivent sur un album,
    // ni sur un titre trop court ; en fin de file, la lecture continue enchaîne comme avant.
    const maybeCrossfade = (audio: HTMLAudioElement) => {
      const seconds = crossfadeSeconds();
      if (!seconds || fadeRef.current || fadeStartingRef.current || audio.paused) return;
      if (repeatModeRef.current === "one" || !isFinite(audio.duration)) return;
      if (audio.duration < 2 * seconds + 5 || audio.duration - audio.currentTime > seconds) return;
      const q = queueRef.current;
      const idx = queueIndexRef.current;
      const nextIndex = idx + 1 < q.length ? idx + 1 : repeatModeRef.current === "all" && q.length > 1 ? 0 : -1;
      const current = currentTrackRef.current;
      const next = q[nextIndex];
      if (!next || !current || sameAlbumInOrder(current, next)) return;
      startCrossfade(next, nextIndex);
    };

    let lastKick = 0;
    const handleTimeUpdate = own((audio) => {
      setCurrentTime(audio.currentTime);
      if (Math.abs(audio.currentTime - lastKick) >= 5) {
        lastKick = audio.currentTime;
        kickPrefetch();
      }
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
      maybeCrossfade(audio);
    });

    const handleLoadedMetadata = own((audio) => {
      setDuration(audio.duration);
    });

    const handlePlay = own(() => {
      resumeEqualizer(); // lecture relancée hors de l'appli (écran verrouillé, CarPlay)
      setIsPlaying(true);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    });
    const handlePause = own(() => {
      setIsPlaying(false);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    });

    // GESTION CRITIQUE DU PASSAGE AUTOMATIQUE AU TITRE SUIVANT
    const handleEnded = own((audio) => {
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
    });

    // Tolérance aux pannes réseau : passer automatiquement au morceau suivant après 400ms si erreur
    // de flux, mais pas indéfiniment (serveur injoignable : chaque titre échouerait à son tour)
    let errorStreak = 0;
    const handleError = own((audio) => {
      const track = currentTrackRef.current;
      const at = audio.currentTime || 0;
      if (track && isPrecharge(audio.src)) {
        // Copie préchargée illisible (effacée par le navigateur) : le flux prend le relais, même titre
        console.warn("Copie préchargée illisible, retour au flux");
        forgetPrefetched(track);
        resumeFrom(audio, audioSource(track), at);
        return;
      }
      if (track && isPrefetched(track)) {
        // Flux coupé (réseau perdu) alors que le titre est déjà dans le cache : on continue dessus
        resumeFrom(audio, audioSource(track), at);
        return;
      }
      console.warn("Erreur de lecture audio, tentative de reprise sur la piste suivante…");
      if (++errorStreak <= 5) window.setTimeout(advance, 400);
    });
    const handlePlaying = own(() => {
      errorStreak = 0;
      kickPrefetch();
    });

    // Le flux s'arrête faute de débit, mais le titre est déjà dans le cache : on y passe
    const handleWaiting = own((audio) => {
      const track = currentTrackRef.current;
      if (!track || isPrecharge(audio.src) || !isPrefetched(track)) return;
      resumeFrom(audio, audioSource(track), audio.currentTime);
    });

    // Flux figé sans erreur (VPN ou réseau mobile qui ne transmet plus rien, requête du titre
    // suivant jamais aboutie) : le navigateur attendrait indéfiniment, il fallait rouvrir l'appli.
    // Une lecture en cours (non mise en pause) qui n'avance plus depuis STALL_MS repart du même
    // endroit, depuis la copie préchargée si elle est prête ; après STALL_RETRIES essais, le titre
    // est sauté.
    const STALL_MS = 10000;
    const STALL_RETRIES = 3;
    const stall = { audio: null as HTMLAudioElement | null, src: "", time: -1, since: Date.now(), retries: 0, retryAt: 0 };
    const watchdog = window.setInterval(() => {
      const audio = audioRef.current;
      const track = currentTrackRef.current;
      const now = Date.now();
      if (!audio || !track || !audio.src || audio.paused || audio.ended || fadeRef.current) {
        stall.since = now;
        return;
      }
      if (audio !== stall.audio || audio.src !== stall.src) {
        // Nouveau titre (ou nouvelle source après une relance) : la mesure repart de zéro
        if (audio.src !== stall.src && !isPrecharge(audio.src) && !isPrecharge(stall.src)) stall.retries = 0;
        Object.assign(stall, { audio, src: audio.src, time: audio.currentTime, since: now });
        return;
      }
      if (audio.currentTime !== stall.time) {
        if (audio.currentTime > stall.retryAt + 5) stall.retries = 0; // le titre est vraiment reparti
        stall.time = audio.currentTime;
        stall.since = now;
        return;
      }
      if (now - stall.since < STALL_MS) return;
      stall.since = now;
      if (stall.retries >= STALL_RETRIES) {
        console.warn("Titre bloqué malgré les relances : titre suivant");
        stall.retries = 0;
        advance();
        return;
      }
      stall.retries++;
      stall.retryAt = audio.currentTime;
      console.warn(`Lecture bloquée depuis ${STALL_MS / 1000} s : relance ${stall.retries}/${STALL_RETRIES}`);
      if (isPrecharge(audio.src)) forgetPrefetched(track); // copie illisible : retour au flux
      resumeFrom(audio, audioSource(track), audio.currentTime);
      audio.play().catch(() => {}); // garde le lecteur « en lecture » pendant le chargement
    }, 2000);

    const listeners: [string, EventListener][] = [
      ["timeupdate", handleTimeUpdate],
      ["timeupdate", stepFade], // fondu en arrière-plan, sur les deux lecteurs
      ["loadedmetadata", handleLoadedMetadata],
      ["ended", handleEnded],
      ["play", handlePlay],
      ["pause", handlePause],
      ["error", handleError],
      ["playing", handlePlaying],
      ["waiting", handleWaiting],
      ["progress", kickPrefetch],
    ];
    for (const deck of decks) for (const [type, fn] of listeners) deck.addEventListener(type, fn);

    return () => {
      window.clearInterval(watchdog);
      for (const deck of decks) {
        deck.pause();
        for (const [type, fn] of listeners) deck.removeEventListener(type, fn);
      }
    };
  }, [advance, startCrossfade, stepFade]);

  // Dernier titre de la file entamé : la suite est préparée à l'avance (visible dans « À suivre »)
  useEffect(() => {
    if (!currentTrack || repeatMode !== "off") return;
    if (queueRef.current.length - 1 - queueIndexRef.current <= 0) extendWithRadio();
  }, [currentTrack, repeatMode, extendWithRadio]);

  // Titres à précharger (#56), dans l'ordre où ils vont passer : le suivant d'abord (il démarrera
  // sans réseau), puis le titre en cours (filet en cas de coupure), puis celui d'après. Mode
  // « économie de données » du téléphone : le suivant seulement.
  useEffect(() => {
    if (!currentTrack) return setPrefetchWanted([]);
    const after = (k: number) => {
      const i = queueIndex + k;
      if (i < queue.length) return queue[i];
      return repeatMode === "all" && queue.length ? queue[i % queue.length] : null;
    };
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    const wanted =
      repeatMode === "one" ? [currentTrack] : saveData ? [after(1)] : [after(1), currentTrack, after(2)];
    setPrefetchWanted(wanted.filter((t): t is MediaItem => !!t));
  }, [currentTrack, queue, queueIndex, repeatMode]);

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

  // Lancement d'un titre (#60). Avec `newQueue` (boutons « Lire » d'un album, d'une playlist, d'un
  // mix) : la file est remplacée par la liste. Sans (un titre touché dans une liste) : la file ne
  // bouge pas ; le titre y est rejoint s'il y est déjà, sinon inséré juste après le titre en cours.
  const playTrack = useCallback((track: MediaItem, newQueue?: MediaItem[], startIndex?: number) => {
    if (!audioRef.current) return;
    finishFade();

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

    const audio = audioRef.current;
    audio.src = audioSource(track);
    audio.currentTime = 0;
    // Geste de l'utilisateur : le moteur audio (égaliseur, fondu) peut démarrer, et l'autre lecteur
    // est débloqué pour pouvoir lancer seul le titre suivant (fondu enchaîné sur iPhone)
    resumeEqualizer();
    audio.play().catch((err) => console.log("Audio autoplay prevented:", err));
    decksRef.current.forEach((d) => d !== audio && primeDeck(d));
  }, [finishFade]);

  const pauseTrack = useCallback(() => {
    if (audioRef.current) {
      finishFade();
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [finishFade]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      finishFade();
      audio.pause();
    } else {
      resumeEqualizer();
      audio.play().catch((e) => console.log(e));
      decksRef.current.forEach((d) => d !== audio && primeDeck(d));
    }
  }, [finishFade]);

  const setVolume = useCallback((value: number) => {
    const v = Math.min(1, Math.max(0, value));
    setUserVolume(v);
    if (!fadeRef.current) decksRef.current.forEach((d) => setLevel(d, 1));
    setVolumeState(v);
  }, []);

  const seek = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    finishFade();
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  }, [finishFade]);

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
