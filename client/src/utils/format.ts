import { MediaItem } from "../types";

// Titre principal d'un élément (pour un épisode : le nom de la série)
export function displayTitle(item: MediaItem): string {
  if (item.type === "episode") return item.grandparentTitle || item.parentTitle || item.title;
  return item.title;
}

export function episodeCode(item: MediaItem): string {
  if (item.seasonNumber == null || item.episodeNumber == null) return "";
  return `S${item.seasonNumber} · É${item.episodeNumber}`;
}

export function remainingLabel(item: MediaItem): string {
  const mins = Math.max(0, Math.round((item.duration - item.viewOffset) / 60000));
  return mins > 0 ? `${mins} min restantes` : "Bientôt terminé";
}

// "S1 · É4 — 18 min restantes" / "Film — 22 min restantes"
export function resumeSubtitle(item: MediaItem): string {
  const prefix = item.type === "episode" ? episodeCode(item) || "Épisode" : "Film";
  return `${prefix} — ${remainingLabel(item)}`;
}

export function formatRuntime(minutes: number): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function formatTrackDuration(ms: number): string {
  return formatClock(Math.round(ms / 1000));
}

export function typeLabel(type: MediaItem["type"]): string {
  switch (type) {
    case "movie": return "Film";
    case "show": return "Série";
    case "episode": return "Épisode";
    case "album": return "Album";
    case "artist": return "Artiste";
    case "track": return "Titre";
  }
}

export function resolutionLabel(res?: string | null): string {
  if (!res) return "";
  const r = res.toLowerCase();
  if (r === "4k") return "4K";
  if (/^\d+$/.test(r)) return `${r}p`;
  return r.toUpperCase();
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 18) return "Bonjour";
  return "Bonsoir";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Couleur d'avatar stable dérivée d'un nom
const AVATAR_COLORS = ["#2f6fe0", "#c47a12", "#1d9a7a", "#8b5cf6", "#d0436b", "#0f8fb3"];
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
