// Fondu enchaîné entre deux titres (#59) : réglage (durée, gardée sur l'appareil) et niveaux des
// deux lecteurs. Le niveau passe par la Web Audio API quand le lecteur y est branché (égaliseur,
// ou iPhone, où Safari ignore le volume des éléments audio), sinon par le volume de l'élément.
import { useSyncExternalStore } from "react";
import { inputGain, setGraphNeeded } from "./equalizer";

export const MAX_CROSSFADE = 12; // secondes

export const isIOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// Sur iPhone, désactivé tant qu'on ne l'a pas choisi : il fait passer la musique par la Web Audio
// API, qui peut s'arrêter écran verrouillé (à vérifier sur chaque appareil)
const DEFAULT_SECONDS = isIOS ? 0 : 6;
const STORAGE_KEY = "nomad-crossfade";

function load(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return Math.max(0, Math.min(MAX_CROSSFADE, Math.round(Number(raw)) || 0));
  } catch {
    // Stockage indisponible
  }
  return DEFAULT_SECONDS;
}

let seconds = load();
const listeners = new Set<() => void>();
setGraphNeeded(isIOS && seconds > 0);

export const crossfadeSeconds = () => seconds;

export function setCrossfadeSeconds(value: number) {
  seconds = Math.max(0, Math.min(MAX_CROSSFADE, Math.round(value)));
  try {
    localStorage.setItem(STORAGE_KEY, String(seconds));
  } catch {
    // Gardé jusqu'à la fermeture
  }
  setGraphNeeded(isIOS && seconds > 0);
  listeners.forEach((l) => l());
}

export function useCrossfade(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => seconds,
  );
}

// --- Niveaux ---

let userVolume = 1; // curseur de volume du lecteur (ordinateur)

export function setUserVolume(v: number) {
  userVolume = v;
}

// Niveau d'un lecteur, de 0 (coupé) à 1 (volume normal)
export function setLevel(el: HTMLAudioElement, level: number) {
  const gain = inputGain(el);
  if (gain) {
    // Lissé sur ~50 ms : les pas du fondu (4 à 60 par seconde) ne s'entendent pas
    gain.gain.setTargetAtTime(level, gain.context.currentTime, 0.05);
    el.volume = userVolume;
  } else {
    el.volume = Math.max(0, Math.min(1, level * userVolume));
  }
}

// Courbe à puissance constante : le volume perçu ne creuse pas au milieu du fondu
export const fadeIn = (p: number) => Math.sin((Math.min(1, Math.max(0, p)) * Math.PI) / 2);
export const fadeOut = (p: number) => Math.cos((Math.min(1, Math.max(0, p)) * Math.PI) / 2);

// Deux titres qui se suivent sur un même album : pas de fondu (morceaux enchaînés, live)
export const sameAlbumInOrder = (
  a: { parentTitle?: string; trackNumber?: number },
  b: { parentTitle?: string; trackNumber?: number },
) => !!a.parentTitle && a.parentTitle === b.parentTitle && !!a.trackNumber && b.trackNumber === a.trackNumber + 1;

// Un lecteur doit avoir joué une fois sur un geste de l'utilisateur pour pouvoir démarrer seul
// plus tard (iPhone) : on lui fait jouer un dixième de seconde de silence
const primed = new WeakSet<HTMLAudioElement>();
const SILENCE = (() => {
  const samples = 800; // 0,1 s à 8 kHz
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
})();

export function primeDeck(el: HTMLAudioElement) {
  if (primed.has(el) || (el.src && !el.paused)) return;
  primed.add(el);
  if (el.src) return;
  el.src = SILENCE;
  el.play()
    .then(() => el.pause())
    .catch(() => {})
    .finally(() => {
      if (el.src === SILENCE) el.removeAttribute("src");
    });
}
