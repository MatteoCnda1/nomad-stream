import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { MediaDetail, MediaItem } from "../types";
import { reportTimeline, beaconTimeline, getDeviceId } from "../api";
import { useAudio } from "../context/AudioContext";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize2,
  Minimize2,
  Subtitles,
  Volume2,
  Tv,
  Gauge,
  Check,
  AlertTriangle,
} from "lucide-react";
import {
  QUALITIES,
  QualityId,
  QualityPref,
  TxSession,
  TxVariant,
  canCopyVideo,
  canDirectPlay,
  loadBandwidth,
  loadQualityPref,
  lowerQuality,
  pickAutoQuality,
  pickStartVariant,
  qualityKbps,
  qualityLabel,
  saveBandwidth,
  saveQualityPref,
  txAvailable,
} from "../streaming";

interface VideoPlayerProps {
  media: MediaDetail;
  localSrc?: string | null; // version téléchargée sur l'appareil (mode hors connexion)
  onClose: () => void;
}

type Phase = "loading" | "playing" | "buffering" | "error";
// direct : fichier lu tel quel ; hls : conversion Plex (une qualité) ; abr : conversion iGPU multi-débits
type Active = { mode: "direct" | "hls" | "abr"; quality: QualityId };

// Délais généreux : un segment peut attendre que le transcodeur redémarre après un saut.
// Tampon de 2 minutes (jusqu'à 3) pour absorber les creux du réseau mobile sans coupure.
const retry = (maxNumRetry: number, retryDelayMs: number, maxRetryDelayMs: number) => ({ maxNumRetry, retryDelayMs, maxRetryDelayMs });
const HLS_CONFIG = {
  maxBufferLength: 120,
  maxMaxBufferLength: 180,
  maxBufferSize: 150 * 1000 * 1000,
  backBufferLength: 30,
  manifestLoadPolicy: { default: { maxTimeToFirstByteMs: 20000, maxLoadTimeMs: 30000, timeoutRetry: retry(2, 0, 0), errorRetry: retry(2, 1000, 4000) } },
  playlistLoadPolicy: { default: { maxTimeToFirstByteMs: 20000, maxLoadTimeMs: 30000, timeoutRetry: retry(2, 0, 0), errorRetry: retry(3, 1000, 4000) } },
  fragLoadPolicy: { default: { maxTimeToFirstByteMs: 45000, maxLoadTimeMs: 120000, timeoutRetry: retry(3, 0, 0), errorRetry: retry(5, 1000, 8000) } },
};

// Coupures : au-delà de 6 s d'attente, ou 3 coupures en une minute, le mode Auto baisse d'un palier
const LONG_STALL_MS = 6000;
const STALL_WINDOW_MS = 60000;
const STALLS_BEFORE_DOWNGRADE = 3;

const newSessionId = () => "nomad-" + Math.random().toString(36).slice(2, 12);

// Statistiques d'un segment HLS : attente que Plex le prépare, puis transfert réseau
type FragSample = { ttfbMs: number; transferMs: number; bytes: number };
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Safari (macOS, iOS) : HLS natif, plus fiable (AirPlay, image dans l'image, écran verrouillé)
const isAppleWebKit = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android|Edg/.test(navigator.userAgent));

const formatTime = (secs: number) => {
  if (!isFinite(secs)) return "0:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

// Écran d'attente (aussi affiché par App pendant le chargement des métadonnées)
export const PlayerLoadingScreen: React.FC<{ item: MediaItem; status: string; onClose: () => void }> = ({ item, status, onClose }) => (
  <div className="fixed inset-0 z-50 bg-black text-white flex items-center justify-center overflow-hidden">
    {(item.art || item.thumb) && (
      <img src={item.art || item.thumb || ""} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30 blur-2xl scale-110" />
    )}
    <button
      type="button"
      onClick={onClose}
      aria-label="Fermer"
      className="absolute left-4 top-[max(16px,env(safe-area-inset-top))] w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center"
    >
      <ArrowLeft className="w-6 h-6" />
    </button>
    <div className="relative flex flex-col items-center gap-5 px-6 text-center" role="status" aria-live="polite">
      <span className="w-14 h-14 rounded-full border-4 border-white/20 border-t-[#e5131d] animate-spin" />
      <div>
        <div className="text-lg font-semibold line-clamp-2">{item.grandparentTitle || item.title}</div>
        <div className="mt-1 text-sm text-white/70">{status}</div>
      </div>
    </div>
  </div>
);

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ media, localSrc, onClose }) => {
  const { pauseTrack } = useAudio();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const sessionRef = useRef<string | null>(null);
  const activeRef = useRef<Active | null>(null);
  const positionRef = useRef(0);
  const sessionExpiredRef = useRef(false);
  const txRef = useRef<TxSession | null>(null);
  const txRefusedRef = useRef(false);
  const loadIdRef = useRef(0);
  const [txVariants, setTxVariants] = useState<TxVariant[]>([]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState("Préparation de la lecture…");
  const [errorText, setErrorText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [duration, setDuration] = useState(media.duration ? media.duration / 1000 : 0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [menu, setMenu] = useState<"audio" | "subtitles" | "quality" | null>(null);

  const [qualityPref, setQualityPref] = useState<QualityPref>(loadQualityPref);
  const qualityPrefRef = useRef(qualityPref);

  // Pistes audio & sous-titres (le choix n'est envoyé à Plex que s'il change pendant la séance)
  const defaultAudioId = media.audioStreams.find((s) => s.selected)?.id ?? media.audioStreams[0]?.id ?? null;
  const defaultSubtitleId = media.subtitleStreams.find((s) => s.selected)?.id ?? null;
  const [selectedAudio, setSelectedAudio] = useState<number | null>(defaultAudioId);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number | null>(defaultSubtitleId);
  const tracksRef = useRef<{ audio: number | null; subtitle: number | null; dirty: boolean }>({
    audio: defaultAudioId,
    subtitle: defaultSubtitleId,
    dirty: false,
  });

  // Suivi des coupures
  const stallStartRef = useRef(0);
  const stallsRef = useRef<number[]>([]);
  const lastSeekRef = useRef(0);
  const lastDowngradeRef = useRef(0);
  const restartsRef = useRef<number[]>([]);
  const fragSamplesRef = useRef<FragSample[]>([]);
  const transcoderWarnedRef = useRef(false);

  const controlsTimeoutRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 5000);
  };

  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlayingRef.current) setShowControls(false);
    }, 3500);
  };

  const timeline = (state: "playing" | "paused" | "stopped") => ({
    ratingKey: media.id,
    key: media.key,
    state,
    time: positionRef.current * 1000,
    duration: (videoRef.current?.duration || media.duration / 1000) * 1000,
  });

  const setActiveMode = (next: Active) => {
    activeRef.current = next;
    setActive(next);
  };

  // Arrête le flux en cours (lecteur + session de conversion, Plex ou iGPU)
  const teardown = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.removeAttribute("src");
      video.load();
    }
    if (sessionRef.current) {
      fetch(`/api/stream/hls/stop?session=${sessionRef.current}`).catch(() => {});
      sessionRef.current = null;
    }
    if (txRef.current) {
      fetch(`/api/tx/${txRef.current.job}/stop`).catch(() => {});
      txRef.current = null;
    }
  };

  const safePlay = () => {
    videoRef.current?.play().catch(() => {
      // Lecture automatique refusée (geste utilisateur expiré) : on laisse le bouton lecture
      setPhase("playing");
      setShowControls(true);
    });
  };

  const seekWhenReady = (video: HTMLVideoElement, time: number) => {
    if (time <= 0) return;
    video.addEventListener("loadedmetadata", () => { video.currentTime = time; }, { once: true });
  };

  // Événements communs à tous les flux lus par hls.js : mesure du débit et reprise sur erreur
  const wireHls = (hls: Hls) => {
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    let lastSave = 0;
    hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
      const { loading, loaded } = data.frag.stats;
      const sample = { ttfbMs: loading.first - loading.start, transferMs: Math.max(1, loading.end - loading.first), bytes: loaded };
      fragSamplesRef.current = [...fragSamplesRef.current.slice(-5), sample];
      // Débit réseau = octets / durée du transfert (hors attente du transcodeur : un flux converti
      // arrive au rythme de la conversion, ce n'est pas la capacité du réseau). Une mesure en cours
      // de lecture ne fait que relever le débit mémorisé ; seules de vraies coupures l'abaissent.
      const samples = fragSamplesRef.current.filter((s) => s.bytes > 200_000);
      if (samples.length >= 3 && Date.now() - lastSave > 15000) {
        lastSave = Date.now();
        const kbps = median(samples.map((s) => (s.bytes * 8) / s.transferMs));
        saveBandwidth(Math.max(loadBandwidth() ?? 0, kbps));
      }
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || hlsRef.current !== hls) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 1) {
        networkRecoveries++;
        hls.startLoad(positionRef.current);
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
        if (mediaRecoveries++ > 0) hls.swapAudioCodec();
        hls.recoverMediaError();
        return;
      }
      restartAfterFailure();
    });
  };

  // Flux multi-débits produit par l'iGPU de la passerelle : le lecteur change de qualité
  // segment par segment selon le débit, sans coupure ni relance
  const startAbr = (tx: TxSession, startTime: number, pref: QualityPref) => {
    const video = videoRef.current;
    if (!video) return;
    txRef.current = tx;
    setTxVariants(tx.variants);
    const locked = pref !== "auto" && pref !== "original" ? pref : undefined;
    const first = pickStartVariant(tx.variants, loadBandwidth(), locked);
    setActiveMode({ mode: "abr", quality: first.id });
    setStatus(`Préparation du flux ${qualityLabel(first.id)}…`);

    const useNative = video.canPlayType("application/vnd.apple.mpegurl") !== "" && (isAppleWebKit() || !Hls.isSupported());
    if (useNative) {
      // Safari adapte lui-même la qualité ; il démarre sur la première variante annoncée
      video.src = locked ? `/api/tx/${tx.job}/v${first.index}/index.m3u8` : `${tx.master}?first=${first.index}`;
      seekWhenReady(video, startTime);
      safePlay();
      return;
    }
    const hls = new Hls({
      ...HLS_CONFIG,
      startPosition: startTime > 0 ? startTime : -1,
      abrEwmaDefaultEstimate: (loadBandwidth() ?? 6000) * 1000,
      capLevelToPlayerSize: true,
    });
    hlsRef.current = hls;
    wireHls(hls);
    const levelOf = (v: TxVariant) => hls.levels.findIndex((l) => l.width === v.width && l.height === v.height);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const idx = levelOf(first);
      if (idx >= 0) {
        if (locked) hls.currentLevel = idx;
        else hls.startLevel = idx;
      }
      safePlay();
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = hls.levels[data.level];
      const v = tx.variants.find((x) => x.width === level?.width && x.height === level?.height);
      if (v && hlsRef.current === hls) setActiveMode({ mode: "abr", quality: v.id });
    });
    hls.loadSource(`${tx.master}?first=${first.index}`);
    hls.attachMedia(video);
  };

  const startPlayback = async (
    startTime: number,
    opts: { quality?: QualityPref; forceHls?: boolean; forcePlex?: boolean } = {}
  ) => {
    const video = videoRef.current;
    if (!video) return;
    const loadId = ++loadIdRef.current;
    teardown();
    setPhase("loading");
    setErrorText("");
    stallStartRef.current = 0;
    stallsRef.current = [];
    fragSamplesRef.current = [];
    sessionExpiredRef.current = false;
    positionRef.current = startTime;

    // 0. Version téléchargée : lue depuis l'appareil, sans réseau ni conversion
    if (localSrc) {
      setActiveMode({ mode: "direct", quality: "original" });
      setStatus("Lecture du téléchargement…");
      video.src = localSrc;
      seekWhenReady(video, startTime);
      safePlay();
      return;
    }

    const { audio, subtitle, dirty } = tracksRef.current;
    const subtitles = subtitle != null;
    const pref: QualityPref = opts.quality ?? qualityPrefRef.current;

    // 1. Lecture directe : le navigateur lit le fichier par plages HTTP, sans aucune conversion
    const wantsOriginal =
      pref === "original" || (pref === "auto" && pickAutoQuality(media, loadBandwidth(), subtitles) === "original");
    if (!opts.forceHls && wantsOriginal && canDirectPlay(media, { defaultAudio: audio === defaultAudioId, subtitles })) {
      setActiveMode({ mode: "direct", quality: "original" });
      setStatus("Lecture directe du fichier…");
      video.src = media.directStreamUrl;
      seekWhenReady(video, startTime);
      safePlay();
      return;
    }

    // 2. Conversion par l'iGPU de la passerelle, en plusieurs qualités à la fois
    if (!opts.forcePlex && !subtitles && pref !== "original" && !txRefusedRef.current && (await txAvailable())) {
      if (loadId !== loadIdRef.current) return;
      setStatus("Préparation du flux…");
      try {
        const audioIndex = media.audioStreams.find((s) => s.id === audio)?.index;
        const r = await fetch("/api/tx/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: media.id, audioIndex, start: startTime }),
        });
        const data = await r.json().catch(() => ({}));
        if (loadId !== loadIdRef.current) {
          if (r.ok) fetch(`/api/tx/${data.job}/stop`).catch(() => {});
          return;
        }
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        startAbr(data as TxSession, startTime, pref);
        return;
      } catch (error) {
        if (loadId !== loadIdRef.current) return;
        // Source non prise en charge (HDR…) ou fichier absent de la passerelle : conversion par Plex
        txRefusedRef.current = true;
        console.warn("Conversion iGPU impossible, repli sur Plex :", error);
      }
    }

    // 3. Conversion par Plex : sous-titres incrustés, qualité originale d'un MKV, ou repli
    let quality: QualityId = pref === "auto" ? pickAutoQuality(media, loadBandwidth(), subtitles) : pref;
    // Sous-titres incrustés = vidéo réencodée : sans plafond, Plex viserait 20 Mb/s en 1080p
    if (subtitles && quality === "original") quality = "1080p";
    setActiveMode({ mode: "hls", quality });
    setStatus(`Préparation du flux ${qualityLabel(quality)}…`);

    const session = newSessionId();
    sessionRef.current = session;
    const params = new URLSearchParams({
      id: media.id,
      session,
      client: getDeviceId(),
      quality,
      offset: String(Math.floor(startTime)),
    });
    if (dirty && media.partId) {
      params.set("partId", media.partId);
      if (audio != null) params.set("audioStreamID", String(audio));
      params.set("subtitleStreamID", String(subtitle ?? 0));
    }
    const url = `/api/stream/hls/start.m3u8?${params}`;

    const useNative = video.canPlayType("application/vnd.apple.mpegurl") !== "" && (isAppleWebKit() || !Hls.isSupported());
    if (useNative) {
      video.src = url;
      seekWhenReady(video, startTime);
      safePlay();
      return;
    }
    if (!Hls.isSupported()) {
      setPhase("error");
      setErrorText("Ce navigateur ne sait pas lire ce format vidéo.");
      return;
    }

    const hls = new Hls({ ...HLS_CONFIG, startPosition: startTime > 0 ? startTime : -1 });
    hlsRef.current = hls;
    wireHls(hls);
    hls.on(Hls.Events.MANIFEST_PARSED, () => safePlay());
    hls.loadSource(url);
    hls.attachMedia(video);
  };

  // Échec du flux : on relance une nouvelle session au même endroit (3 fois max en 2 minutes)
  const restartAfterFailure = () => {
    if (localSrc) {
      teardown();
      setPhase("error");
      setErrorText("Ce téléchargement est illisible. Supprimez-le puis téléchargez-le à nouveau.");
      return;
    }
    const now = Date.now();
    restartsRef.current = restartsRef.current.filter((t) => now - t < 120000);
    if (restartsRef.current.length >= 3) {
      const at = positionRef.current;
      teardown();
      positionRef.current = at;
      setPhase("error");
      setErrorText("La connexion au serveur est trop instable pour continuer la lecture.");
      return;
    }
    restartsRef.current.push(now);
    const cur = activeRef.current;
    // Flux iGPU qui échoue deux fois de suite : on passe par le transcodeur de Plex
    if (cur?.mode === "abr") {
      startPlayback(positionRef.current, { forcePlex: restartsRef.current.length >= 2 });
      return;
    }
    // Vidéo HEVC/AV1 recopiée en "originale" que l'appareil ne sait pas décoder : on la convertit
    if (cur?.mode === "hls" && cur.quality === "original" && !canCopyVideo(media)) {
      const fallback = pickAutoQuality(media, loadBandwidth(), tracksRef.current.subtitle != null);
      showToast(`Format vidéo non lisible sur cet appareil : conversion en ${qualityLabel(fallback)}`);
      startPlayback(positionRef.current, { quality: fallback });
      return;
    }
    // Un fichier refusé en lecture directe (codec inattendu) passe par un transcodeur
    startPlayback(positionRef.current, { quality: cur?.mode === "direct" ? undefined : cur?.quality, forceHls: cur?.mode === "direct" });
  };

  // Uniquement pour le flux Plex à qualité unique : le flux iGPU s'adapte tout seul (ABR)
  const maybeDowngrade = () => {
    const cur = activeRef.current;
    const now = Date.now();
    if (!cur || cur.mode !== "hls" || qualityPrefRef.current !== "auto" || now - lastDowngradeRef.current < 20000) return;
    // Si les segments arrivent vite une fois prêts mais que Plex met longtemps à les préparer,
    // c'est la conversion (ex. 4K HEVC sans accélération matérielle) qui ne suit pas, pas le réseau :
    // baisser la qualité n'y changerait rien
    const recent = fragSamplesRef.current.slice(-4);
    if (hlsRef.current && recent.length >= 2) {
      if (median(recent.map((s) => s.ttfbMs)) > 2 * median(recent.map((s) => s.transferMs))) {
        if (!transcoderWarnedRef.current) {
          transcoderWarnedRef.current = true;
          showToast("Le serveur peine à convertir ce fichier en temps réel");
        }
        return;
      }
    }
    const next = lowerQuality(cur.quality, media);
    if (!next) return;
    lastDowngradeRef.current = now;
    // Mémoriser une connexion plus lente : les prochaines lectures démarreront directement plus bas
    const curKbps = cur.quality === "original" ? media.bitrate || 0 : qualityKbps(cur.quality) || 0;
    if (curKbps) saveBandwidth(Math.min(loadBandwidth() ?? Infinity, curKbps * 0.9));
    showToast(`Connexion instable : passage en ${qualityLabel(next)}`);
    startPlayback(positionRef.current, { quality: next });
  };

  // Initialisation du flux vidéo
  useEffect(() => {
    pauseTrack();
    const initialTime = media.viewOffset && media.viewOffset > 5000 ? media.viewOffset / 1000 : 0;
    startPlayback(initialTime);

    // Scrobble régulier vers Plex (toutes les 10s)
    const report = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused) reportTimeline(timeline("playing"));
    }, 10000);

    // Session Plex maintenue en vie pendant les pauses ; coupure longue détectée chaque seconde
    const ping = window.setInterval(async () => {
      const session = sessionRef.current;
      if (!session) return;
      try {
        const r = await fetch(`/api/stream/hls/ping?session=${session}`);
        if (r.status === 410 && sessionRef.current === session) sessionExpiredRef.current = true;
      } catch {
        // Réseau coupé : la reprise sera gérée par les erreurs du lecteur
      }
    }, 30000);
    const stallWatch = window.setInterval(() => {
      if (stallStartRef.current && Date.now() - stallStartRef.current > LONG_STALL_MS) maybeDowngrade();
    }, 1000);

    // Fermeture d'onglet : arrêter le transcodage et enregistrer la position quoi qu'il arrive
    const onPageHide = () => {
      if (sessionRef.current) navigator.sendBeacon?.(`/api/stream/hls/stop?session=${sessionRef.current}`);
      if (txRef.current) navigator.sendBeacon?.(`/api/tx/${txRef.current.job}/stop`);
      beaconTimeline(timeline("stopped"));
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      clearInterval(report);
      clearInterval(ping);
      clearInterval(stallWatch);
      window.removeEventListener("pagehide", onPageHide);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      loadIdRef.current++;
      const stopped = timeline("stopped");
      teardown();
      reportTimeline(stopped);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Événements de l'élément <video> ---

  const onPlaying = () => {
    const now = Date.now();
    setPhase("playing");
    restartsRef.current = [];
    tracksRef.current.dirty = false;
    if (stallStartRef.current) {
      stallsRef.current = [...stallsRef.current.filter((t) => now - t < STALL_WINDOW_MS), now];
      stallStartRef.current = 0;
      if (stallsRef.current.length >= STALLS_BEFORE_DOWNGRADE) maybeDowngrade();
    }
  };

  const onWaiting = () => {
    const video = videoRef.current;
    if (!video || phase === "loading" || phase === "error") return;
    setPhase("buffering");
    // Une attente juste après un saut est normale (le transcodeur redémarre) : ce n'est pas une coupure
    if (!video.seeking && Date.now() - lastSeekRef.current > 2500 && !stallStartRef.current) {
      stallStartRef.current = Date.now();
    }
  };

  const onVideoError = () => {
    // hls.js gère ses propres erreurs ; ici : lecture directe ou HLS natif (Safari)
    if (hlsRef.current || !activeRef.current || !videoRef.current?.getAttribute("src")) return;
    restartAfterFailure();
  };

  const onProgress = () => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.5 && video.buffered.end(i) >= video.currentTime) {
        setBufferedEnd(video.buffered.end(i));
        return;
      }
    }
  };

  // --- Commandes ---

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || phase === "loading") return;
    if (video.paused) {
      // Pause très longue : Plex a fermé la session, on la relance au même endroit
      if (sessionExpiredRef.current && activeRef.current) {
        startPlayback(positionRef.current, { quality: activeRef.current.quality });
      } else {
        safePlay();
      }
      reportTimeline(timeline("playing"));
    } else {
      video.pause();
      reportTimeline(timeline("paused"));
    }
    resetControlsTimeout();
  };

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const max = isFinite(video.duration) ? video.duration : duration;
    const target = Math.max(0, Math.min(max || 0, time));
    lastSeekRef.current = Date.now();
    stallStartRef.current = 0;
    video.currentTime = target;
    positionRef.current = target;
    setCurrentTime(target);
    resetControlsTimeout();
  };

  const skip = (seconds: number) => seekTo((videoRef.current?.currentTime || 0) + seconds);

  const chooseQuality = (pref: QualityPref) => {
    setMenu(null);
    setQualityPref(pref);
    qualityPrefRef.current = pref;
    saveQualityPref(pref);
    lastDowngradeRef.current = Date.now();
    // Flux multi-débits lu par hls.js : simple changement de palier au prochain segment, sans relance
    const hls = hlsRef.current;
    const tx = txRef.current;
    if (hls && tx && activeRef.current?.mode === "abr" && pref !== "original") {
      if (pref === "auto") {
        hls.nextLevel = -1;
        return;
      }
      const v = pickStartVariant(tx.variants, null, pref);
      const idx = hls.levels.findIndex((l) => l.width === v.width && l.height === v.height);
      if (idx >= 0) {
        hls.nextLevel = idx;
        setActiveMode({ mode: "abr", quality: v.id });
        return;
      }
    }
    startPlayback(positionRef.current, pref === "auto" ? {} : { quality: pref });
  };

  const chooseTrack = (kind: "audio" | "subtitles", id: number | null) => {
    setMenu(null);
    if (kind === "audio") {
      setSelectedAudio(id);
      tracksRef.current = { ...tracksRef.current, audio: id, dirty: true };
    } else {
      setSelectedSubtitle(id);
      tracksRef.current = { ...tracksRef.current, subtitle: id, dirty: true };
    }
    startPlayback(positionRef.current, qualityPrefRef.current === "auto" ? {} : { quality: qualityPrefRef.current });
  };

  // Gestes tactiles pour double tap (skip 10s)
  const handleTouchEnd = (e: React.TouchEvent) => {
    const now = Date.now();
    const touch = e.changedTouches[0];
    const diff = now - lastTapRef.current.time;
    const x = touch.clientX;

    if (diff < 300) {
      const screenWidth = window.innerWidth;
      if (x < screenWidth * 0.4) skip(-10);
      else if (x > screenWidth * 0.6) skip(10);
      else togglePlay();
    } else {
      resetControlsTimeout();
    }

    lastTapRef.current = { time: now, x };
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => console.log(err));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch((err) => console.log(err));
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.log("Erreur PiP :", e);
    }
  };

  const qualityBadge = localSrc
    ? "Téléchargé"
    : active
    ? `${qualityPref === "auto" ? "Auto · " : ""}${active.mode === "direct" ? "Direct" : qualityLabel(active.quality)}`
    : "…";
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;
  const estimate = loadBandwidth();

  const menuItem = (key: string | number, label: string, detail: string | null, selected: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3.5 py-3 rounded-xl text-sm transition flex items-center gap-3 ${
        selected ? "bg-[#e5131d] text-white font-semibold" : "text-white/85 hover:bg-white/[.07]"
      }`}
    >
      <span className="flex-1 min-w-0">
        <span className="block truncate">{label}</span>
        {detail && <span className={`block text-xs ${selected ? "text-white/80" : "text-white/50"}`}>{detail}</span>}
      </span>
      {selected && <Check className="w-4 h-4 flex-shrink-0" strokeWidth={2.4} />}
    </button>
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={resetControlsTimeout}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden text-white"
    >
      {/* Lecteur Vidéo HTML5 */}
      <video
        ref={videoRef}
        playsInline
        onPlaying={onPlaying}
        onWaiting={onWaiting}
        onSeeking={() => { lastSeekRef.current = Date.now(); }}
        onPlay={() => { isPlayingRef.current = true; setIsPlaying(true); resetControlsTimeout(); }}
        onPause={() => { isPlayingRef.current = false; setIsPlaying(false); setShowControls(true); }}
        onError={onVideoError}
        onProgress={onProgress}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (!video || phase === "loading") return;
          if (video.currentTime > 0) positionRef.current = video.currentTime;
          setCurrentTime(video.currentTime);
          onProgress();
        }}
        onLoadedMetadata={() => videoRef.current && isFinite(videoRef.current.duration) && setDuration(videoRef.current.duration)}
        onEnded={() => {
          positionRef.current = videoRef.current?.duration || positionRef.current;
          reportTimeline(timeline("stopped"));
        }}
        className="w-full h-full object-contain"
      />

      {/* CHARGEMENT INITIAL */}
      {phase === "loading" && (
        <div className="absolute inset-0">
          <PlayerLoadingScreen item={media} status={status} onClose={onClose} />
        </div>
      )}

      {/* MISE EN MÉMOIRE TAMPON */}
      {phase === "buffering" && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none" role="status" aria-label="Chargement">
          <span className="w-14 h-14 rounded-full border-4 border-white/20 border-t-[#e5131d] animate-spin" />
        </div>
      )}

      {/* ERREUR */}
      {phase === "error" && (
        <div className="absolute inset-0 z-10 bg-black/85 flex items-center justify-center p-6">
          <div className="max-w-sm text-center flex flex-col items-center gap-4" role="alert">
            <AlertTriangle className="w-10 h-10 text-[#ff4d55]" />
            <p className="text-base font-semibold">{errorText}</p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  restartsRef.current = [];
                  startPlayback(positionRef.current, { quality: activeRef.current?.quality });
                }}
                className="h-11 px-5 rounded-full bg-[#e5131d] hover:bg-[#f52a33] font-semibold"
              >
                Réessayer
              </button>
              <button type="button" onClick={onClose} className="h-11 px-5 rounded-full bg-white/10 hover:bg-white/20 font-medium">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATION (baisse de qualité automatique) */}
      {toast && (
        <div role="status" className="fixed z-[60] left-1/2 -translate-x-1/2 top-[max(76px,calc(env(safe-area-inset-top)+60px))] px-4 py-2.5 rounded-2xl bg-[#1c1c21]/95 text-sm shadow-lg flex items-center gap-2.5">
          <Gauge className="w-4 h-4 text-[#ff4d55]" />
          {toast}
        </div>
      )}

      {/* OVERLAY DE CONTRÔLES */}
      <div
        className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/80 flex flex-col justify-between p-4 sm:p-6 transition-opacity duration-300 ${
          showControls && phase !== "loading" && phase !== "error" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Barre Supérieure */}
        <div className="flex items-center justify-between gap-3 safe-top">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onClose}
              aria-label="Fermer le lecteur"
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition active:scale-95 flex-shrink-0"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold line-clamp-1">
                {media.parentTitle ? `${media.grandparentTitle || media.parentTitle} - ${media.title}` : media.title}
              </h2>
              {media.type === "episode" && media.seasonNumber !== undefined && (
                <p className="text-xs text-white/70">
                  Saison {media.seasonNumber} • Épisode {media.episodeNumber}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => !localSrc && setMenu("quality")}
              className="h-11 pl-3 pr-3.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center gap-2 text-xs font-semibold"
              aria-label={`Qualité : ${qualityBadge}`}
            >
              <Gauge className="w-5 h-5" />
              <span className="hidden sm:inline">{qualityBadge}</span>
            </button>

            {media.audioStreams.length > 1 && (
              <button
                onClick={() => setMenu("audio")}
                className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95"
                aria-label="Piste audio"
              >
                <Volume2 className="w-5 h-5" />
              </button>
            )}

            {media.subtitleStreams.length > 0 && (
              <button
                onClick={() => setMenu("subtitles")}
                className={`p-2.5 rounded-full active:scale-95 transition ${
                  selectedSubtitle ? "bg-[#e5131d]" : "bg-white/10 hover:bg-white/20"
                }`}
                aria-label="Sous-titres"
              >
                <Subtitles className="w-5 h-5" />
              </button>
            )}

            <button
              onClick={togglePiP}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95"
              aria-label="Image dans l'image"
            >
              <Tv className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Centre : Boutons Skip & Play/Pause */}
        <div className="flex items-center justify-center gap-10">
          <button
            onClick={() => skip(-10)}
            className="p-4 rounded-full bg-white/10 hover:bg-white/20 transition active:scale-90"
            aria-label="Reculer de 10 secondes"
          >
            <RotateCcw className="w-8 h-8" />
          </button>

          <button
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Lecture"}
            className="p-6 rounded-full bg-[#e5131d] hover:bg-[#f52a33] shadow-[0_18px_36px_-12px_rgba(229,19,29,.7)] transition active:scale-90"
          >
            {isPlaying ? <Pause className="w-10 h-10 fill-current" /> : <Play className="w-10 h-10 fill-current ml-1" />}
          </button>

          <button
            onClick={() => skip(10)}
            className="p-4 rounded-full bg-white/10 hover:bg-white/20 transition active:scale-90"
            aria-label="Avancer de 10 secondes"
          >
            <RotateCw className="w-8 h-8" />
          </button>
        </div>

        {/* Barre Inférieure : Scrubber (lu + mis en mémoire) & Temps */}
        <div className="space-y-2 safe-bottom">
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-white/80 w-14 text-right">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={1}
              value={currentTime}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              aria-label="Position de lecture"
              className="range flex-1"
              style={
                {
                  "--pct": `${progressPct}%`,
                  "--range-fill": "#e5131d",
                  "--range-thumb": "#ffffff",
                  "--range-track": `linear-gradient(rgba(255,255,255,.45), rgba(255,255,255,.45)) 0 / ${bufferedPct}% 100% no-repeat, rgba(255,255,255,.2)`,
                } as React.CSSProperties
              }
            />
            <span className="text-xs tabular-nums text-white/80 w-14">{formatTime(duration)}</span>
            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
              className="p-2 hover:text-white/80 transition active:scale-95"
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* MENUS : QUALITÉ, PISTES AUDIO & SOUS-TITRES */}
      {menu && (
        <div
          onClick={() => setMenu(null)}
          className="absolute inset-0 bg-black/70 backdrop-blur-sm z-30 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="bg-[#17171b] border border-white/10 rounded-3xl p-5 max-w-sm w-full space-y-4"
          >
            <h3 className="text-base font-bold flex items-center gap-2">
              {menu === "quality" && <Gauge className="w-5 h-5 text-[#ff4d55]" />}
              {menu === "audio" && <Volume2 className="w-5 h-5 text-[#ff4d55]" />}
              {menu === "subtitles" && <Subtitles className="w-5 h-5 text-[#ff4d55]" />}
              {menu === "quality" ? "Qualité de lecture" : menu === "audio" ? "Piste audio" : "Sous-titres"}
            </h3>

            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {menu === "quality" && (
                <>
                  {menuItem(
                    "auto",
                    "Auto",
                    active ? `Adaptée à votre connexion · actuellement ${active.mode === "direct" ? "lecture directe" : qualityLabel(active.quality)}` : "Adaptée à votre connexion",
                    qualityPref === "auto",
                    () => chooseQuality("auto")
                  )}
                  {QUALITIES.filter((q) => q.id === "original" || !txVariants.length || txVariants.some((v) => v.id === q.id)).map((q) => {
                    const v = txVariants.find((x) => x.id === q.id);
                    const mbps = (kbps: number) => `${(kbps / 1000).toFixed(1).replace(".", ",")} Mb/s`;
                    return menuItem(
                      q.id,
                      q.label,
                      q.id === "original"
                        ? `${q.detail}${media.bitrate ? ` · ${mbps(media.bitrate)}` : ""}`
                        : v
                        ? `${v.width}×${v.height} · ${mbps(v.kbps)}`
                        : q.detail,
                      qualityPref === q.id,
                      () => chooseQuality(q.id)
                    );
                  })}
                  {estimate != null && (
                    <p className="px-1 pt-2 text-xs text-white/50">
                      Connexion mesurée : ~{(estimate / 1000).toFixed(1).replace(".", ",")} Mb/s
                    </p>
                  )}
                </>
              )}

              {menu === "subtitles" &&
                menuItem("off", "Désactivés", null, selectedSubtitle === null, () => chooseTrack("subtitles", null))}

              {menu === "audio" &&
                media.audioStreams.map((s) =>
                  menuItem(s.id, s.title || s.language, s.codec?.toUpperCase() || null, selectedAudio === s.id, () => chooseTrack("audio", s.id))
                )}
              {menu === "subtitles" &&
                media.subtitleStreams.map((s) =>
                  menuItem(s.id, s.title || s.language, "Incrustés dans l'image", selectedSubtitle === s.id, () => chooseTrack("subtitles", s.id))
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
