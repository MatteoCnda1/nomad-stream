import React, { useState } from "react";
import { Download, Check, AlertTriangle } from "lucide-react";
import { MediaDetail, MediaItem } from "../types";
import { fetchMetadata } from "../api";
import { useDownloads, DownloadEntry } from "../context/DownloadsContext";
import { OFFLINE_QUALITIES, OfflineQuality } from "../offline";

const LAST_QUALITY_KEY = "nomad-offline-quality";
const lastQuality = (): OfflineQuality => {
  try {
    return localStorage.getItem(LAST_QUALITY_KEY) === "480p" ? "480p" : "720p";
  } catch {
    return "720p";
  }
};

const pct = (p: number) => `${Math.round(p * 100)} %`;

export function downloadLabel(entry: DownloadEntry | undefined): string {
  if (!entry) return "Télécharger";
  if (entry.state === "preparing") return entry.progress > 0 ? `Préparation ${pct(entry.progress)}` : "En attente…";
  if (entry.state === "downloading") return `Téléchargement ${pct(entry.progress)}`;
  if (entry.state === "done") return "Téléchargé";
  return "Réessayer";
}

// Bouton complet (fiche film) : choix de la qualité au premier appui
export const DownloadButton: React.FC<{ media: MediaDetail; className?: string }> = ({ media, className = "" }) => {
  const { supported, reason, forItem, start, retry } = useDownloads();
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const entry = forItem(media.id);

  const onClick = () => {
    if (!supported) return setNotice(reason);
    if (media.missing && entry?.state !== "done") {
      return setNotice("Fichier absent du disque du serveur : téléchargement impossible.");
    }
    if (!entry) return setChoosing((v) => !v);
    if (entry.state === "error") retry(entry.id);
  };

  const choose = (q: OfflineQuality) => {
    setChoosing(false);
    try {
      localStorage.setItem(LAST_QUALITY_KEY, q);
    } catch {
      // Ignore
    }
    start(media, q);
  };

  const busy = entry && (entry.state === "preparing" || entry.state === "downloading");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-expanded={choosing}
        className={`press relative overflow-hidden h-12 px-4 rounded-[14px] border border-line2 hover:bg-card flex items-center justify-center gap-2 text-sm font-medium w-full ${
          entry?.state === "done" ? "text-accent-text" : ""
        } ${className}`}
      >
        {busy && (
          <span className="absolute inset-y-0 left-0 bg-accent-soft transition-[width] duration-500" style={{ width: pct(entry.progress) }} />
        )}
        <span className="relative flex items-center gap-2">
          {entry?.state === "done" ? (
            <Check className="w-[18px] h-[18px]" strokeWidth={2.2} />
          ) : entry?.state === "error" ? (
            <AlertTriangle className="w-[18px] h-[18px] text-accent-text" strokeWidth={1.9} />
          ) : (
            <Download className="w-[18px] h-[18px]" strokeWidth={1.9} />
          )}
          {downloadLabel(entry)}
        </span>
      </button>

      {choosing && (
        <div className="absolute z-20 left-0 right-0 sm:right-auto sm:min-w-[260px] top-[calc(100%+8px)] rounded-2xl bg-surface border border-line shadow-[0_20px_40px_-16px_rgba(0,0,0,.45)] p-1.5">
          {OFFLINE_QUALITIES.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => choose(q.id)}
              className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-card"
            >
              <span className="block text-sm font-semibold">{q.label}</span>
              <span className="block text-xs text-muted">{q.detail}</span>
            </button>
          ))}
        </div>
      )}
      {notice && <p className="mt-2 text-xs text-muted max-w-[280px]">{notice}</p>}
      {!notice && entry?.state === "error" && entry.error && (
        <p className="mt-2 text-xs text-muted max-w-[280px]">Échec : {entry.error}</p>
      )}
    </div>
  );
};

// Icône compacte (liste d'épisodes) : anneau de progression, coche une fois téléchargé
export const EpisodeDownloadButton: React.FC<{ episode: MediaItem }> = ({ episode }) => {
  const { supported, forItem, start, retry } = useDownloads();
  const [loading, setLoading] = useState(false);
  if (!supported) return null;
  const entry = forItem(episode.id);
  const busy = loading || (entry && (entry.state === "preparing" || entry.state === "downloading"));

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (entry?.state === "error") return retry(entry.id);
    if (entry) return;
    setLoading(true);
    try {
      start(await fetchMetadata(episode.id), lastQuality());
    } finally {
      setLoading(false);
    }
  };

  const r = 15;
  const circ = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${downloadLabel(entry)} : ${episode.title}`}
      title={downloadLabel(entry)}
      className={`press relative w-10 h-10 rounded-full grid place-items-center flex-shrink-0 hover:bg-surface3 ${
        entry?.state === "done" ? "text-accent-text" : entry?.state === "error" ? "text-accent-text" : "text-muted hover:text-fg"
      }`}
    >
      {busy && (
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r={r} fill="none" stroke="var(--line2)" strokeWidth="2.5" />
          <circle cx="20" cy="20" r={r} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - (entry?.progress || 0))} className="transition-[stroke-dashoffset] duration-500" />
        </svg>
      )}
      {entry?.state === "done" ? (
        <Check className="w-[18px] h-[18px]" strokeWidth={2.4} />
      ) : entry?.state === "error" ? (
        <AlertTriangle className="w-[16px] h-[16px]" strokeWidth={2} />
      ) : (
        <Download className={`w-[17px] h-[17px] ${busy ? "scale-75" : ""}`} strokeWidth={1.9} />
      )}
    </button>
  );
};
