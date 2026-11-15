import { MediaDetail } from "./types";

// Paliers de qualité (doivent correspondre à QUALITY_PRESETS dans server/index.js)
export type QualityId = "original" | "1080p" | "720p" | "480p" | "360p";
export type QualityPref = "auto" | QualityId;

export const QUALITIES: { id: QualityId; label: string; kbps: number | null; detail: string }[] = [
  { id: "original", label: "Originale", kbps: null, detail: "Sans réencodage" },
  { id: "1080p", label: "1080p", kbps: 8000, detail: "8 Mb/s" },
  { id: "720p", label: "720p", kbps: 4000, detail: "4 Mb/s" },
  { id: "480p", label: "480p", kbps: 1500, detail: "1,5 Mb/s" },
  { id: "360p", label: "360p", kbps: 750, detail: "0,75 Mb/s" },
];

// Le mode Auto ne choisit jamais le 1080p transcodé : sans accélération matérielle, le serveur
// l'encode à peine plus vite que le temps réel (≈1,5x), ce qui provoque des coupures
const AUTO_LADDER: QualityId[] = ["720p", "480p", "360p"];
// Marge entre débit du flux et débit mesuré (le réseau mobile fluctue)
const HEADROOM = 1.3;
// Débit supposé tant que la connexion n'a pas été mesurée (première lecture) : l'original s'il est
// léger, sinon 720p, sûr en 4G comme en Wi-Fi. hls.js mesure ensuite le débit réel pendant la lecture.
const DEFAULT_BUDGET_KBPS = 6000;

export const qualityKbps = (q: QualityId) => QUALITIES.find((x) => x.id === q)?.kbps ?? null;
export const qualityLabel = (q: QualityId) => QUALITIES.find((x) => x.id === q)?.label ?? q;

// Le navigateur sait-il lire le fichier tel quel (sans passer par le transcodeur Plex) ?
export function canDirectPlay(media: MediaDetail, opts: { defaultAudio: boolean; subtitles: boolean }) {
  return (
    ["mp4", "m4v", "mov"].includes(media.container || "") &&
    media.videoCodec === "h264" &&
    ["aac", "mp3"].includes(media.audioCodec || "") &&
    opts.defaultAudio &&
    !opts.subtitles
  );
}

// Seul le H.264 recopié tel quel est lisible partout : le HEVC ou l'AV1 placés dans un flux HLS
// (MPEG-TS) ne passent ni sur iPhone ni sur Firefox, il faut les convertir
export const canCopyVideo = (media: MediaDetail) => media.videoCodec === "h264";

// Choix automatique : l'original si la connexion le permet, sinon le meilleur palier qui passe
export function pickAutoQuality(media: MediaDetail, estimateKbps: number | null, subtitles: boolean): QualityId {
  const source = media.bitrate || 0;
  const budget = estimateKbps ?? DEFAULT_BUDGET_KBPS;
  if (!subtitles && canCopyVideo(media) && source && source * HEADROOM <= budget) return "original";
  for (const q of AUTO_LADDER) {
    const kbps = qualityKbps(q)!;
    // Inutile de "réduire" vers un palier plus lourd qu'une source lisible telle quelle
    // (un HEVC/AV1 doit de toute façon être converti : 720p reste alors le bon choix)
    if (source && kbps >= source && canCopyVideo(media)) continue;
    if (kbps * HEADROOM <= budget) return q;
  }
  return "360p";
}

// Palier inférieur après des coupures (null : on est déjà au plus bas)
export function lowerQuality(current: QualityId, media: MediaDetail): QualityId | null {
  if (current === "original") {
    const source = media.bitrate || Infinity;
    return AUTO_LADDER.find((q) => qualityKbps(q)! < source) ?? null;
  }
  const order: QualityId[] = ["1080p", "720p", "480p", "360p"];
  const i = order.indexOf(current);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}

// --- Transcodeur iGPU de la passerelle (flux multi-débits) ---

export type TxVariant = { index: number; id: QualityId; width: number; height: number; kbps: number };
export type TxSession = { job: string; master: string; variants: TxVariant[] };

// Capacités de la passerelle : conversion iGPU et mode hors connexion (une requête par chargement).
// Les dernières connues sont mémorisées : hors connexion, la page Téléchargements reste cohérente.
const CAPS_KEY = "nomad-gateway-caps";
let caps: Promise<{ available: boolean; offline: boolean }> | null = null;
export function gatewayCaps() {
  caps ??= fetch("/api/tx/available")
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: { available?: boolean; offline?: boolean }) => {
      const value = { available: !!d.available, offline: !!d.offline };
      try {
        localStorage.setItem(CAPS_KEY, JSON.stringify(value));
      } catch {
        // Ignore
      }
      return value;
    })
    .catch(() => {
      caps = null; // réessayer plus tard (ex. lancement hors connexion)
      try {
        const known = JSON.parse(localStorage.getItem(CAPS_KEY) || "null");
        if (known) return { available: false, offline: !!known.offline };
      } catch {
        // Ignore
      }
      return { available: false, offline: false };
    });
  return caps;
}

export const txAvailable = () => gatewayCaps().then((c) => c.available);

// Variante de départ : celle verrouillée par l'utilisateur, sinon la meilleure qui passe avec marge
export function pickStartVariant(variants: TxVariant[], estimateKbps: number | null, locked?: QualityId): TxVariant {
  const sorted = [...variants].sort((a, b) => b.kbps - a.kbps);
  if (locked && locked !== "original") {
    const order: QualityId[] = ["1080p", "720p", "480p", "360p"];
    const wanted = order.slice(order.indexOf(locked));
    const match = sorted.find((v) => wanted.includes(v.id));
    if (match) return match;
  }
  const budget = estimateKbps ?? DEFAULT_BUDGET_KBPS;
  return sorted.find((v) => (v.kbps + 128) * HEADROOM <= budget) ?? sorted[sorted.length - 1];
}

// --- Mémoire de la bande passante (par appareil, valable 10 minutes) ---

const BW_KEY = "nomad-bandwidth";
const BW_TTL_MS = 10 * 60 * 1000;

export function loadBandwidth(): number | null {
  try {
    const raw = JSON.parse(localStorage.getItem(BW_KEY) || "null");
    if (raw && typeof raw.kbps === "number" && Date.now() - raw.at < BW_TTL_MS) return raw.kbps;
  } catch {
    // Ignore
  }
  return null;
}

export function saveBandwidth(kbps: number) {
  try {
    localStorage.setItem(BW_KEY, JSON.stringify({ kbps: Math.round(kbps), at: Date.now() }));
  } catch {
    // Ignore
  }
}

export function loadQualityPref(): QualityPref {
  try {
    const v = localStorage.getItem("nomad-quality");
    if (v === "auto" || QUALITIES.some((q) => q.id === v)) return v as QualityPref;
  } catch {
    // Ignore
  }
  return "auto";
}

export function saveQualityPref(pref: QualityPref) {
  try {
    localStorage.setItem("nomad-quality", pref);
  } catch {
    // Ignore
  }
}

// Épisode suivant lancé tout seul à la fin d'un épisode, après un compte à rebours (réglage gardé
// sur l'appareil, activé par défaut)
const AUTONEXT_KEY = "nomad-autonext";

export function loadAutoNext(): boolean {
  try {
    return localStorage.getItem(AUTONEXT_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAutoNext(on: boolean) {
  try {
    localStorage.setItem(AUTONEXT_KEY, on ? "1" : "0");
  } catch {
    // Gardé jusqu'à la fermeture
  }
}
