// Profils et synchronisation des playlists et de « Ma liste » avec la passerelle (#40).
// Chaque appareil garde une copie locale des données du profil choisi (lecture immédiate, et
// hors connexion) ; chaque changement part dans une file d'envoi, gardée elle aussi sur
// l'appareil et rejouée dans l'ordre dès que la passerelle répond.
import { MediaItem, Playlist } from "./types";

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  plex?: boolean;
  plexLinked?: boolean; // progression du compte Plex (sinon : la sienne, gardée par la passerelle, #39)
}

export interface WishlistEntry {
  item: MediaItem;
  savedAt: number;
}

export interface ProfileData {
  playlists: Playlist[];
  wishlist: WishlistEntry[];
  repaired?: number;
}

export const PROFILE_COLORS = ["#e5131d", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"];

// --- Stockage local ---

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Impossible d'enregistrer ${key} :`, e);
  }
}

// Clé locale d'une donnée : par profil, ou celle d'avant les profils (appareil sans profil)
export const localKey = (kind: "playlists" | "wishlist" | "music-downloads", profileId: string | null) =>
  profileId ? `nomad-${kind}-${profileId}` : `nomad-${kind}`;

const CURRENT_KEY = "nomad-profile";
const PROFILES_KEY = "nomad-profiles"; // liste gardée pour l'écran de choix hors connexion
const LEGACY_IMPORTED_KEY = "nomad-legacy-imported";

export const currentProfileId = (): string | null => {
  const id = readLocal<string | null>(CURRENT_KEY, null);
  return typeof id === "string" && /^p_[a-f0-9]{12}$/.test(id) ? id : null;
};
// Le profil part avec chaque requête dans un cookie : la passerelle y lit à qui donner quelle
// position de reprise (#39), y compris pour les rapports envoyés à la fermeture (sendBeacon)
const PROFILE_COOKIE = "nomad_profile";
function setProfileCookie(id: string | null) {
  document.cookie = id
    ? `${PROFILE_COOKIE}=${id}; path=/; max-age=31536000; SameSite=Lax`
    : `${PROFILE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export const setCurrentProfileId = (id: string | null) => {
  setProfileCookie(id);
  return id ? writeLocal(CURRENT_KEY, id) : localStorage.removeItem(CURRENT_KEY);
};

// Cookie effacé (navigateur, réglages) : remis d'après le profil gardé sur l'appareil
if (typeof document !== "undefined") setProfileCookie(currentProfileId());
export const cachedProfiles = () => readLocal<Profile[]>(PROFILES_KEY, []);
export const cacheProfiles = (list: Profile[]) => writeLocal(PROFILES_KEY, list);

// --- Appels à la passerelle ---

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
  });
  if (res.status === 401) window.dispatchEvent(new CustomEvent("nomad-auth-required"));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const fetchProfiles = () => call<{ profiles: Profile[] }>("/api/profiles").then((r) => r.profiles);
export const createProfile = (name: string, color: string) => call<Profile>("/api/profiles", json("POST", { name, color }));
export const updateProfile = (id: string, fields: Partial<Pick<Profile, "name" | "color" | "plex">>) =>
  call<Profile>(`/api/profiles/${id}`, json("PATCH", fields));
export const deleteProfile = (id: string) => call<void>(`/api/profiles/${id}`, { method: "DELETE" });
export const fetchProfileData = (id: string) => call<ProfileData>(`/api/profiles/${id}/data`);

// Playlists et « Ma liste » gardées sur cet appareil avant les profils : versées une seule fois,
// dans le premier profil choisi. Elles restent aussi sous leurs anciennes clés (copie de secours).
export async function importLegacyData(profileId: string): Promise<number> {
  if (readLocal(LEGACY_IMPORTED_KEY, false)) return 0;
  const playlists = readLocal<Playlist[]>(localKey("playlists", null), []);
  const wishlist = readLocal<WishlistEntry[]>(localKey("wishlist", null), []);
  if (!playlists.length && !wishlist.length) {
    writeLocal(LEGACY_IMPORTED_KEY, true);
    return 0;
  }
  const { added } = await call<{ added: number }>(`/api/profiles/${profileId}/import`, json("POST", { playlists, wishlist }));
  writeLocal(LEGACY_IMPORTED_KEY, true);
  return added;
}

// --- File d'envoi ---

interface Op {
  profileId: string;
  method: "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

const QUEUE_KEY = "nomad-sync-queue";
const RETRY_MS = 30000;
let queue: Op[] = readLocal<Op[]>(QUEUE_KEY, []);
let flushing: Promise<void> | null = null;
let retryTimer: number | undefined;
const listeners = new Set<() => void>();

export const subscribeQueue = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const saveQueue = () => {
  writeLocal(QUEUE_KEY, queue);
  listeners.forEach((fn) => fn());
};

export const pendingFor = (profileId: string) => queue.some((op) => op.profileId === profileId);

// Un changement plus récent du même élément remplace celui qui attend encore
export function enqueue(op: Op) {
  queue = queue.filter((o) => o.path !== op.path);
  queue.push(op);
  saveQueue();
  void flushQueue();
}

export function flushQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    while (queue.length) {
      const op = queue[0];
      try {
        await call(op.path, op.body === undefined ? { method: op.method } : json(op.method, op.body));
      } catch (error) {
        const status = (error as { status?: number }).status;
        // Réseau coupé ou passerelle en difficulté : on réessaiera plus tard, dans le même ordre
        if (!status || status >= 500 || status === 401 || status === 408 || status === 429) {
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(() => void flushQueue(), RETRY_MS);
          return;
        }
        // Refus définitif (profil supprimé, donnée invalide) : abandonné
        console.warn(`Synchronisation refusée (${op.method} ${op.path}) :`, (error as Error).message);
      }
      queue = queue.filter((o) => o !== op);
      saveQueue();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// Changements d'un profil supprimé : inutile de les envoyer
export function dropQueued(profileId: string) {
  queue = queue.filter((op) => op.profileId !== profileId);
  saveQueue();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushQueue());
}
