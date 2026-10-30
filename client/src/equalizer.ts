// Égaliseur de la musique, comme celui de Spotify : 6 bandes réglables de −12 à +12 dB, des
// préréglages, et un limiteur pour que les basses poussées ne saturent pas. Le son passe par la
// Web Audio API (filtres biquad) uniquement si l'égaliseur a été activé : tant qu'il ne l'a pas
// été, l'élément audio joue directement, comme avant. Réglages gardés sur l'appareil.
import { useSyncExternalStore } from "react";

export const BANDS = [60, 150, 400, 1000, 2400, 15000] as const; // Hz
export const MAX_DB = 12;
const Q = 1.0; // largeur des bandes intermédiaires

export const bandLabel = (hz: number) => (hz >= 1000 ? `${String(hz / 1000).replace(".", ",")} kHz` : `${hz} Hz`);

// Préréglages (dB par bande, de la plus grave à la plus aiguë)
export const PRESETS: { id: string; label: string; gains: number[] }[] = [
  { id: "plat", label: "Plat", gains: [0, 0, 0, 0, 0, 0] },
  { id: "acoustique", label: "Acoustique", gains: [4, 3, 1, 1, 2, 3] },
  { id: "basses-plus", label: "Basses +", gains: [6, 4, 1, 0, 0, 0] },
  { id: "basses-moins", label: "Basses −", gains: [-6, -4, -1, 0, 0, 0] },
  { id: "classique", label: "Classique", gains: [4, 3, 0, 0, 2, 4] },
  { id: "dance", label: "Dance", gains: [5, 3, 0, 2, 3, 2] },
  { id: "deep", label: "Deep", gains: [5, 3, 1, -1, 2, -3] },
  { id: "electro", label: "Électro", gains: [4, 3, 0, -1, 2, 4] },
  { id: "hip-hop", label: "Hip-hop", gains: [5, 4, 1, 1, -1, 2] },
  { id: "jazz", label: "Jazz", gains: [3, 2, 1, 2, -1, 3] },
  { id: "latino", label: "Latino", gains: [3, 1, 0, 0, -1, 3] },
  { id: "loudness", label: "Loudness", gains: [6, 3, 0, -1, 2, 5] },
  { id: "lounge", label: "Lounge", gains: [-2, 0, 1, 2, 1, 0] },
  { id: "piano", label: "Piano", gains: [2, 1, 0, 2, 3, 2] },
  { id: "pop", label: "Pop", gains: [-1, 1, 3, 3, 1, -1] },
  { id: "rnb", label: "R&B", gains: [6, 5, 1, -1, 2, 3] },
  { id: "rock", label: "Rock", gains: [4, 3, -1, -1, 2, 4] },
  { id: "petites-enceintes", label: "Petites enceintes", gains: [5, 4, 2, 0, -1, -2] },
  { id: "voix-parlee", label: "Voix parlée", gains: [-3, -1, 2, 4, 3, -2] },
  { id: "aigus-plus", label: "Aigus +", gains: [0, 0, 0, 1, 3, 6] },
  { id: "aigus-moins", label: "Aigus −", gains: [0, 0, 0, -1, -3, -6] },
  { id: "voix-plus", label: "Voix +", gains: [-2, -1, 2, 4, 3, 0] },
];

export interface EqSettings {
  enabled: boolean;
  preset: string; // id d'un préréglage, ou "perso"
  gains: number[];
}

const STORAGE_KEY = "nomad-eq";
const DEFAULT: EqSettings = { enabled: false, preset: "plat", gains: [0, 0, 0, 0, 0, 0] };

function load(): EqSettings {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (s && typeof s.enabled === "boolean" && Array.isArray(s.gains) && s.gains.length === BANDS.length) {
      return { enabled: s.enabled, preset: String(s.preset || "perso"), gains: s.gains.map(clampDb) };
    }
  } catch {
    // Stockage indisponible ou réglage illisible
  }
  return DEFAULT;
}

const clampDb = (v: unknown) => Math.max(-MAX_DB, Math.min(MAX_DB, Number(v) || 0));

let settings = load();
const listeners = new Set<() => void>();

// --- Chaîne Web Audio : élément audio → 6 filtres → préampli → limiteur → sortie ---

interface Graph {
  ctx: AudioContext;
  filters: BiquadFilterNode[];
  preamp: GainNode;
  inputs: Map<HTMLAudioElement, GainNode>; // un gain par lecteur (fondu enchaîné, #59)
}
const elements: HTMLAudioElement[] = [];
let graph: Graph | null = null;

export function registerAudioElement(el: HTMLAudioElement) {
  if (elements.includes(el)) return;
  elements.push(el);
  if (graph) connectElement(graph, el);
}

// Définitif : à partir d'ici, l'élément audio ne joue plus que par cette chaîne
function connectElement(g: Graph, el: HTMLAudioElement) {
  const input = g.ctx.createGain();
  g.ctx.createMediaElementSource(el).connect(input).connect(g.filters[0]);
  g.inputs.set(el, input);
}

function ensureGraph(): Graph | null {
  if (graph || !elements.length) return graph;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  // iOS 17+ : la Web Audio API joue alors comme un lecteur de musique (bouton silencieux ignoré)
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  const ctx = new Ctx();
  const filters = BANDS.map((hz, i) => {
    const f = ctx.createBiquadFilter();
    f.type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
    f.frequency.value = hz;
    if (f.type === "peaking") f.Q.value = Q;
    return f;
  });
  const preamp = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  const chain: AudioNode[] = [...filters, preamp, limiter, ctx.destination];
  chain.reduce((a, b) => {
    a.connect(b);
    return b;
  });
  graph = { ctx, filters, preamp, inputs: new Map() };
  for (const el of elements) connectElement(graph, el);
  apply();
  return graph;
}

// Désactivé : les filtres restent en place mais à plat (la chaîne ne peut plus être retirée)
function apply() {
  if (!graph) return;
  const gains = settings.enabled ? settings.gains : BANDS.map(() => 0);
  const now = graph.ctx.currentTime;
  graph.filters.forEach((f, i) => f.gain.setTargetAtTime(gains[i], now, 0.02));
  // Moitié de la plus forte hausse retirée en entrée : le limiteur rattrape le reste
  const boost = Math.max(0, ...gains);
  graph.preamp.gain.setTargetAtTime(Math.pow(10, -boost / 2 / 20), now, 0.02);
}

// À appeler lors d'un geste de l'utilisateur (lecture) : un AudioContext ne démarre qu'ainsi
export function resumeEqualizer() {
  if (settings.enabled) ensureGraph();
  if (graph && graph.ctx.state !== "running") graph.ctx.resume().catch(() => {});
}

// --- Réglages ---

export const getEqualizer = () => settings;

export function setEqualizer(update: Partial<EqSettings>) {
  settings = { ...settings, ...update, gains: (update.gains ?? settings.gains).map(clampDb) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : réglage gardé jusqu'à la fermeture
  }
  if (settings.enabled) resumeEqualizer();
  apply();
  listeners.forEach((l) => l());
}

export function useEqualizer(): EqSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );
}

// --- Courbe de réponse (affichage) : formules des filtres biquad (RBJ Audio EQ Cookbook) ---

const SAMPLE_RATE = 48000;

function biquadDb(type: "lowshelf" | "peaking" | "highshelf", f0: number, gainDb: number, f: number): number {
  if (gainDb === 0) return 0;
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / SAMPLE_RATE;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === "peaking") {
    const alpha = sin / (2 * Q);
    [b0, b1, b2, a0, a1, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  } else {
    // Pente S = 1, comme les filtres de la Web Audio API
    const alpha = (sin / 2) * Math.SQRT2;
    const s = 2 * Math.sqrt(A) * alpha;
    if (type === "lowshelf") {
      [b0, b1, b2] = [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s)];
      [a0, a1, a2] = [A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s];
    } else {
      [b0, b1, b2] = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s)];
      [a0, a1, a2] = [A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
    }
  }
  const w = (2 * Math.PI * f) / SAMPLE_RATE;
  const [c1, s1, c2, s2] = [Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w)];
  const num = Math.hypot(b0 + b1 * c1 + b2 * c2, -(b1 * s1 + b2 * s2));
  const den = Math.hypot(a0 + a1 * c1 + a2 * c2, -(a1 * s1 + a2 * s2));
  return 20 * Math.log10(num / den);
}

// Réponse totale (dB) aux fréquences données
export function responseDb(gains: number[], freqs: number[]): number[] {
  return freqs.map((f) =>
    BANDS.reduce((sum, hz, i) => {
      const type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
      return sum + biquadDb(type, hz, gains[i], f);
    }, 0),
  );
}
