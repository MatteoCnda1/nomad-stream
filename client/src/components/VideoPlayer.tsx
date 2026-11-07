import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { MediaDetail, MediaItem } from "../types";
import { reportTimeline, beaconTimeline, beaconPlaybackLog, getDeviceId } from "../api";
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
  Activity,
  X,
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

// Goulot probable d'après les derniers segments : si Plex met longtemps à les préparer alors qu'ils
// arrivent vite une fois prêts, c'est la conversion qui ne suit pas, pas le réseau
type Bottleneck = "network" | "transcoder";
const bottleneckOf = (samples: FragSample[]): Bottleneck | null => {
  const recent = samples.slice(-4);
  if (recent.length < 2) return null;
  return median(recent.map((s) => s.ttfbMs)) > 2 * median(recent.map((s) => s.transferMs)) ? "transcoder" : "network";
};

// État du transcodeur côté passerelle, pour le panneau de statistiques
type ServerTx =
  | { kind: "igpu"; aheadSeconds: number; paused: boolean; running: boolean; hwDecode: boolean }
  | { kind: "plex"; speed: number | null; throttled: boolean; videoDecision: string | null; hw: boolean };

const fmtMbps = (kbps: number) => `${(kbps / 1000).toFixed(1).replace(".", ",")} Mb/s`;
const fmtSec = (s: number) => `${s.toFixed(1).replace(".", ",")} s`;

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

// Aide affichée par la touche « ? »
const SHORTCUTS: [string, string][] = [
  ["Espace · K", "Lecture / pause"],
  ["← · J", "Reculer de 10 s"],
  ["→ · L", "Avancer de 10 s"],
  ["↑ · ↓", "Volume"],
  ["M", "Couper le son"],
  ["F", "Plein écran"],
  ["C", "Sous-titres"],
  ["0 … 9", "Aller à 0 %, 10 %… 90 %"],
  ["Échap", "Fermer le lecteur"],
];

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
  // Retour visuel bref d'un raccourci clavier (« +10 s », « Volume 60 % »), et aide (touche ?)
  const [flash, setFlash] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
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

  // Statistiques de la séance : panneau « Statistiques » et bilan envoyé au journal du serveur
  const sessionStatsRef = useRef({
    firstLoadAt: 0,
    ttffMs: null as number | null,
    stalls: 0,
    stallMs: 0,
    cause: null as Bottleneck | null,
    qualitySwitches: 0,
    restarts: 0,
    watchedS: 0,
    lastTime: 0,
    error: null as string | null,
    // Images : cumul des sources précédentes (relances, changements de qualité) + source en cours,
    // relevées pendant la lecture (au démontage, <video> n'est déjà plus accessible)
    droppedFrames: 0,
    totalFrames: 0,
    curDropped: 0,
    curTotal: 0,
  });
  const loggedRef = useRef(false);
  const [showStats, setShowStats] = useState(false);
  const [, setStatsTick] = useState(0);
  const [serverTx, setServerTx] = useState<ServerTx | null>(null);

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
    const prev = activeRef.current;
    if (prev && (prev.quality !== next.quality || prev.mode !== next.mode)) sessionStatsRef.current.qualitySwitches++;
    activeRef.current = next;
    setActive(next);
  };

  // Débit estimé : mesuré par hls.js pendant la lecture, sinon le dernier mémorisé pour l'appareil
  const bandwidthKbps = () => {
    const est = hlsRef.current?.bandwidthEstimate;
    return est && isFinite(est) ? Math.round(est / 1000) : loadBandwidth();
  };

  // Bilan de la séance, une seule fois (fermeture du lecteur ou de l'onglet)
  const sendPlaybackLog = () => {
    const s = sessionStatsRef.current;
    if (loggedRef.current || !s.firstLoadAt) return;
    loggedRef.current = true;
    const cur = activeRef.current;
    beaconPlaybackLog({
      id: media.id,
      title: media.parentTitle ? `${media.grandparentTitle || media.parentTitle} - ${media.title}` : media.title,
      mode: localSrc ? "local" : cur?.mode ?? null,
      quality: cur?.quality ?? null,
      ttffMs: s.ttffMs,
      watchedS: Math.round(s.watchedS),
      stalls: s.stalls,
      stallMs: Math.round(s.stallMs),
      qualitySwitches: s.qualitySwitches,
      restarts: s.restarts,
      cause: s.cause,
      bandwidthKbps: bandwidthKbps(),
      droppedFrames: s.droppedFrames + s.curDropped,
      totalFrames: s.totalFrames + s.curTotal,
      error: s.error,
    });
  };

  // Arrête le flux en cours (lecteur + session de conversion, Plex ou iGPU)
  const teardown = () => {
    const stats = sessionStatsRef.current;
    stats.droppedFrames += stats.curDropped;
    stats.totalFrames += stats.curTotal;
    stats.curDropped = stats.curTotal = 0;
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
    if (!sessionStatsRef.current.firstLoadAt) sessionStatsRef.current.firstLoadAt = Date.now();
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

    // Fiche Plex dont le fichier n'est plus sur le disque : inutile de solliciter un transcodeur,
    // Plex accepterait la session puis ne produirait jamais une image
    if (media.missing) {
      setPhase("error");
      setErrorText("Le fichier de ce titre n'est plus sur le disque du serveur.");
      sessionStatsRef.current.error = "missing";
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
        if (r.status === 404 && /introuvable/i.test(data.error || "")) {
          // Le fichier a disparu du disque : Plex n'y arriverait pas mieux
          setPhase("error");
          setErrorText("Le fichier de ce titre n'est plus sur le disque du serveur.");
          sessionStatsRef.current.error = "missing";
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
    if (media.mediaIndex) params.set("mediaIndex", String(media.mediaIndex));
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
    sessionStatsRef.current.restarts++;
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
    // Conversion qui ne suit pas (ex. 4K HEVC sans accélération matérielle) : baisser la qualité
    // n'y changerait rien
    if (hlsRef.current && bottleneckOf(fragSamplesRef.current) === "transcoder") {
      if (!transcoderWarnedRef.current) {
        transcoderWarnedRef.current = true;
        showToast("Le serveur peine à convertir ce fichier en temps réel");
      }
      return;
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
      sendPlaybackLog();
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
      sendPlaybackLog(); // avant teardown, qui remet à zéro les compteurs d'images de <video>
      teardown();
      reportTimeline(stopped);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (errorText) sessionStatsRef.current.error = errorText;
  }, [errorText]);

  // Panneau de statistiques ouvert : mesures locales chaque seconde, transcodeur toutes les 2 s
  useEffect(() => {
    if (!showStats) return;
    let stopped = false;
    const tick = window.setInterval(() => setStatsTick((t) => t + 1), 1000);
    const poll = async () => {
      const query = txRef.current ? `job=${txRef.current.job}` : sessionRef.current ? `session=${sessionRef.current}` : null;
      if (!query) return setServerTx(null);
      try {
        const r = await fetch(`/api/playback/stats?${query}`);
        if (!stopped && r.ok) setServerTx((await r.json()).transcoder ?? null);
      } catch {
        // Réseau coupé : on garde la dernière valeur
      }
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(tick);
      clearInterval(timer);
    };
  }, [showStats]);

  // --- Événements de l'élément <video> ---

  const onPlaying = () => {
    const now = Date.now();
    const stats = sessionStatsRef.current;
    if (stats.ttffMs == null && stats.firstLoadAt) stats.ttffMs = now - stats.firstLoadAt;
    setPhase("playing");
    restartsRef.current = [];
    tracksRef.current.dirty = false;
    if (stallStartRef.current) {
      stats.stalls++;
      stats.stallMs += now - stallStartRef.current;
      stats.cause = bottleneckOf(fragSamplesRef.current) ?? stats.cause;
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

  // --- Raccourcis clavier (ordinateur) ---

  const flashTimeoutRef = useRef<number | null>(null);
  const showFlash = (text: string) => {
    setFlash(text);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setFlash(null), 900);
  };

  // Piste rétablie par C : la dernière choisie, sinon celle par défaut, sinon la première
  const lastSubtitleRef = useRef<number | null>(defaultSubtitleId ?? media.subtitleStreams[0]?.id ?? null);

  const onShortcut = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const onRange = tag === "INPUT" && (target as HTMLInputElement).type === "range";
    if (target?.isContentEditable || tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !onRange)) return;
    // Menu de pistes ou aide ouverts : Échap les ferme, le reste se fait au clavier dans le menu
    if (menu || showHelp) {
      if (e.key === "Escape" || (showHelp && e.key === "?")) {
        e.preventDefault();
        setMenu(null);
        setShowHelp(false);
      }
      return;
    }
    const onControl = tag === "BUTTON" || tag === "A";
    const video = videoRef.current;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    switch (key) {
      case " ":
        if (onControl) return; // le bouton qui a le focus s'en charge
        togglePlay();
        break;
      case "k":
        togglePlay();
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "j":
      case "l": {
        if (onRange && key.startsWith("Arrow")) return; // la barre de lecture avance seconde par seconde
        const back = key === "ArrowLeft" || key === "j";
        skip(back ? -10 : 10);
        showFlash(back ? "−10 s" : "+10 s");
        break;
      }
      case "ArrowUp":
      case "ArrowDown":
        if (!video || onRange) return;
        video.muted = false;
        video.volume = Math.round(Math.min(1, Math.max(0, video.volume + (key === "ArrowUp" ? 0.1 : -0.1))) * 10) / 10;
        showFlash(`Volume ${Math.round(video.volume * 100)} %`);
        break;
      case "m":
        if (!video) return;
        video.muted = !video.muted;
        showFlash(video.muted ? "Son coupé" : "Son rétabli");
        break;
      case "f":
        toggleFullscreen();
        break;
      case "c": {
        if (!media.subtitleStreams.length) return;
        if (selectedSubtitle != null) lastSubtitleRef.current = selectedSubtitle;
        const next = selectedSubtitle == null ? lastSubtitleRef.current : null;
        chooseTrack("subtitles", next);
        showFlash(next == null ? "Sous-titres désactivés" : "Sous-titres activés");
        break;
      }
      case "?":
        setShowHelp(true);
        break;
      case "Escape":
        if (document.fullscreenElement) return; // le navigateur quitte d'abord le plein écran
        onClose();
        break;
      default:
        // 0 à 9 : début, 10 %, 20 %… de la vidéo
        if (!/^[0-9]$/.test(key) || !duration) return;
        seekTo((duration * Number(key)) / 10);
        showFlash(`${Number(key) * 10} %`);
    }
    e.preventDefault();
    resetControlsTimeout();
  };

  const shortcutRef = useRef(onShortcut);
  shortcutRef.current = onShortcut;
  useEffect(() => {
    // Le focus quitte la page derrière (le bouton « Regarder » resté focalisé recevait Espace)
    containerRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => shortcutRef.current(e);
    // Plein écran quitté par Échap ou par le navigateur : l'icône du bouton suit
    const onFullscreen = () => setIsFullscreen(!!document.fullscreenElement);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, []);

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

  // Lignes du panneau « Statistiques » (recalculées à chaque rafraîchissement)
  const statsRows = (): [string, string][] => {
    const video = videoRef.current;
    const cur = activeRef.current;
    const s = sessionStatsRef.current;
    const rows: [string, string][] = [];
    rows.push([
      "Mode",
      localSrc
        ? "Téléchargement (sur l'appareil)"
        : cur?.mode === "direct"
        ? "Lecture directe du fichier"
        : cur?.mode === "abr"
        ? "Conversion iGPU multi-débits"
        : cur?.mode === "hls"
        ? "Conversion Plex"
        : "—",
    ]);
    const shown = video?.videoWidth ? ` · ${video.videoWidth}×${video.videoHeight}` : "";
    rows.push(["Qualité", `${cur ? (cur.mode === "direct" ? "Originale" : qualityLabel(cur.quality)) : "—"}${shown}`]);
    const streamKbps =
      localSrc || !cur
        ? null
        : cur.mode === "abr"
        ? txVariants.find((v) => v.id === cur.quality)?.kbps ?? null
        : cur.quality === "original"
        ? media.bitrate || null
        : qualityKbps(cur.quality);
    if (streamKbps) rows.push(["Débit du flux", fmtMbps(streamKbps)]);
    const bw = bandwidthKbps();
    if (bw) rows.push(["Débit mesuré", fmtMbps(bw)]);
    if (video) {
      let ahead = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime + 0.5 && video.buffered.end(i) >= video.currentTime) {
          ahead = video.buffered.end(i) - video.currentTime;
        }
      }
      rows.push(["Tampon d'avance", fmtSec(ahead)]);
    }
    const recent = fragSamplesRef.current.slice(-4);
    if (recent.length >= 2) {
      const ttfb = Math.round(median(recent.map((x) => x.ttfbMs)));
      const transfer = Math.round(median(recent.map((x) => x.transferMs)));
      rows.push(["Segments", `préparation ${ttfb} ms · transfert ${transfer} ms`]);
    }
    if (serverTx?.kind === "igpu") {
      rows.push([
        "Transcodeur iGPU",
        `${fmtSec(serverTx.aheadSeconds)} d'avance${serverTx.paused ? " (en pause : assez d'avance)" : ""}${serverTx.hwDecode ? "" : " · décodage CPU"}`,
      ]);
    } else if (serverTx?.kind === "plex") {
      const speed = serverTx.speed != null ? `${serverTx.speed.toFixed(1).replace(".", ",")}× temps réel` : "—";
      rows.push(["Transcodeur Plex", `${speed}${serverTx.throttled ? " (ralenti : assez d'avance)" : ""}${serverTx.hw ? " · matériel" : ""}`]);
    }
    rows.push(["1re image", s.ttffMs != null ? fmtSec(s.ttffMs / 1000) : "…"]);
    rows.push([
      "Coupures",
      s.stalls
        ? `${s.stalls} (${fmtSec(s.stallMs / 1000)})${s.cause ? ` · cause probable : ${s.cause === "network" ? "réseau" : "conversion"}` : ""}`
        : "aucune",
    ]);
    const q = video?.getVideoPlaybackQuality?.();
    if (q?.totalVideoFrames) rows.push(["Images perdues", `${q.droppedVideoFrames} sur ${q.totalVideoFrames}`]);
    if (s.qualitySwitches || s.restarts) {
      rows.push(["Changements", `${s.qualitySwitches} de qualité · ${s.restarts} relance${s.restarts > 1 ? "s" : ""}`]);
    }
    return rows;
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
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Lecture : ${media.title}`}
      onMouseMove={resetControlsTimeout}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden text-white outline-none"
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
          // Temps réellement regardé : les sauts (écart > 2 s) ne comptent pas
          const stats = sessionStatsRef.current;
          const delta = video.currentTime - stats.lastTime;
          if (delta > 0 && delta < 2) stats.watchedS += delta;
          stats.lastTime = video.currentTime;
          const frames = video.getVideoPlaybackQuality?.();
          if (frames) {
            stats.curDropped = frames.droppedVideoFrames;
            stats.curTotal = frames.totalVideoFrames;
          }
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
      {/* Raccourci clavier : retour visuel, lu aussi par les lecteurs d'écran */}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed z-[60] left-1/2 -translate-x-1/2 top-[22%] px-5 py-2.5 rounded-2xl bg-black/70 text-lg font-semibold tabular-nums transition-opacity ${
          flash ? "opacity-100" : "opacity-0"
        }`}
      >
        {flash}
      </div>

      {/* Aide des raccourcis (touche ?) */}
      {showHelp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-title"
          className="fixed inset-0 z-[70] bg-black/70 grid place-items-center p-4"
          onClick={() => setShowHelp(false)}
        >
          <div className="w-full max-w-sm rounded-3xl bg-[#1c1c21] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="shortcuts-title" className="text-lg font-bold">Raccourcis clavier</h2>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
              {SHORTCUTS.map(([keys, label]) => (
                <React.Fragment key={label}>
                  <dt className="font-mono text-white/90 whitespace-nowrap">{keys}</dt>
                  <dd className="text-white/70">{label}</dd>
                </React.Fragment>
              ))}
            </dl>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="mt-6 h-10 px-5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-semibold"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed z-[60] left-1/2 -translate-x-1/2 top-[max(76px,calc(env(safe-area-inset-top)+60px))] px-4 py-2.5 rounded-2xl bg-[#1c1c21]/95 text-sm shadow-lg flex items-center gap-2.5">
          <Gauge className="w-4 h-4 text-[#ff4d55]" />
          {toast}
        </div>
      )}

      {/* STATISTIQUES DE LECTURE (restent affichées quand les commandes s'effacent) */}
      {showStats && (
        <div
          role="region"
          aria-label="Statistiques de lecture"
          onTouchEnd={(e) => e.stopPropagation()}
          className="absolute z-20 left-4 top-[max(96px,calc(env(safe-area-inset-top)+84px))] w-[min(340px,calc(100vw-32px))] rounded-2xl bg-black/80 backdrop-blur-md border border-white/10 p-4 text-xs"
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#ff4d55]" />
              Statistiques
            </span>
            <button
              type="button"
              onClick={() => setShowStats(false)}
              aria-label="Fermer les statistiques"
              className="w-7 h-7 rounded-full grid place-items-center hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 tabular-nums">
            {statsRows().map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-white/55">{label}</dt>
                <dd className="text-white/90">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
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
              onClick={() => setShowStats((v) => !v)}
              className={`p-2.5 rounded-full active:scale-95 transition ${showStats ? "bg-[#e5131d]" : "bg-white/10 hover:bg-white/20"}`}
              aria-label="Statistiques de lecture"
              aria-pressed={showStats}
            >
              <Activity className="w-5 h-5" />
            </button>
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
            aria-keyshortcuts="ArrowLeft J"
            title="Reculer de 10 secondes (←)"
          >
            <RotateCcw className="w-8 h-8" />
          </button>

          <button
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Lecture"}
            aria-keyshortcuts="Space K"
            title={`${isPlaying ? "Pause" : "Lecture"} (espace)`}
            className="p-6 rounded-full bg-[#e5131d] hover:bg-[#f52a33] shadow-[0_18px_36px_-12px_rgba(229,19,29,.7)] transition active:scale-90"
          >
            {isPlaying ? <Pause className="w-10 h-10 fill-current" /> : <Play className="w-10 h-10 fill-current ml-1" />}
          </button>

          <button
            onClick={() => skip(10)}
            className="p-4 rounded-full bg-white/10 hover:bg-white/20 transition active:scale-90"
            aria-label="Avancer de 10 secondes"
            aria-keyshortcuts="ArrowRight L"
            title="Avancer de 10 secondes (→)"
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
              aria-keyshortcuts="F"
              title={`${isFullscreen ? "Quitter le plein écran" : "Plein écran"} (F)`}
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
