import React, { useEffect, useState } from "react";
import { Download, Play, Trash2, RotateCw, WifiOff } from "lucide-react";
import { useDownloads, DownloadEntry } from "../context/DownloadsContext";
import { useMusicDownloads } from "../context/MusicDownloadsContext";
import { useAudio } from "../context/AudioContext";
import { PlaylistArt } from "../components/PlaylistArt";
import { downloadedUsage } from "../musicOffline";
import { CollectionHeader, MetaDot } from "../components/Collection";
import { downloadLabel } from "../components/DownloadButton";
import { OFFLINE_QUALITIES, formatBytes, storageEstimate } from "../offline";
import { displayTitle, episodeCode, formatRuntime } from "../utils/format";

interface DownloadsViewProps {
  onPlay: (entry: DownloadEntry) => void;
  onOpenPlaylist: (playlistId: string) => void;
  onExplore: () => void;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({ onPlay, onOpenPlaylist, onExplore }) => {
  const { supported, reason, entries, remove, retry } = useDownloads();
  const music = useMusicDownloads();
  const { playTrack } = useAudio();
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [musicSize, setMusicSize] = useState(0);
  const done = entries.filter((e) => e.state === "done");
  const totalSize = done.reduce((sum, e) => sum + (e.size || 0), 0) + musicSize;
  const playlists = music.downloadedPlaylists;
  const musicDone = playlists.reduce((sum, p) => sum + music.statusOf(p).done, 0);

  useEffect(() => {
    storageEstimate().then(setStorage);
    downloadedUsage().then(setMusicSize);
  }, [entries.length, done.length, musicDone, playlists.length]);

  // Lecture d'une playlist téléchargée : ses titres présents sur l'appareil
  const playPlaylist = (id: string) => {
    const pl = playlists.find((p) => p.id === id);
    const tracks = pl?.tracks.filter(music.isTrackDownloaded) ?? [];
    if (tracks.length) playTrack(tracks[0], tracks, 0);
  };

  return (
    <div>
      <CollectionHeader
        art={
          <div className="w-[120px] h-[120px] sm:w-[176px] sm:h-[176px] rounded-3xl bg-gradient-to-br from-[#3a3a42] to-[#141418] grid place-items-center flex-shrink-0 shadow-[0_30px_60px_-24px_rgba(0,0,0,.55)]">
            <Download className="w-12 h-12 sm:w-[64px] sm:h-[64px] text-white" strokeWidth={1.6} />
          </div>
        }
        eyebrow="Sur cet appareil"
        title="Téléchargements"
        meta={
          <>
            <span>
              {done.length} {done.length > 1 ? "vidéos" : "vidéo"}
            </span>
            <MetaDot />
            <span>
              {playlists.length} {playlists.length > 1 ? "playlists" : "playlist"}
            </span>
            {totalSize > 0 && <><MetaDot /><span>{formatBytes(totalSize)}</span></>}
          </>
        }
      />

      {!supported && reason && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-2xl bg-card text-sm">
          <WifiOff className="w-5 h-5 text-muted flex-shrink-0 mt-0.5" strokeWidth={1.8} />
          <p className="text-muted leading-relaxed">{reason}</p>
        </div>
      )}

      {storage && (
        <div className="mb-6 max-w-md">
          <div className="flex justify-between text-xs text-muted mb-1.5">
            <span>Espace utilisé par l'appli</span>
            <span>
              {formatBytes(storage.usage)} sur {formatBytes(storage.quota)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-line2 overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, (storage.usage / storage.quota) * 100)}%` }} />
          </div>
        </div>
      )}

      {playlists.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold tracking-[-0.01em]">Musique</h2>
          <div className="flex flex-col gap-1">
            {playlists.map((pl) => {
              const st = music.statusOf(pl);
              return (
                <div key={pl.id} className="flex items-center gap-3.5 p-2 -mx-2 rounded-[18px] hover:bg-card transition-colors">
                  <button
                    type="button"
                    onClick={() => onOpenPlaylist(pl.id)}
                    className="flex-1 min-w-0 flex items-center gap-3.5 text-left"
                  >
                    <PlaylistArt tracks={pl.tracks} className="w-16 h-16 sm:w-[72px] sm:h-[72px] flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold truncate">{pl.title}</span>
                      <span className={`mt-0.5 block text-[13px] truncate ${st.failed ? "text-accent-text" : "text-muted"}`}>
                        {st.active
                          ? `Téléchargement… ${st.done} sur ${st.total}`
                          : `${st.done} ${st.done > 1 ? "titres" : "titre"}`}
                        {st.failed > 0 && ` · ${st.failed} indisponible${st.failed > 1 ? "s" : ""}`}
                      </span>
                      {st.active && (
                        <span className="mt-2 block h-1 rounded-full bg-line2 overflow-hidden max-w-[260px]">
                          <span
                            className="block h-full bg-accent transition-[width] duration-500"
                            style={{ width: `${st.total ? Math.round((st.done / st.total) * 100) : 0}%` }}
                          />
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => playPlaylist(pl.id)}
                    disabled={st.done === 0}
                    aria-label={`Lire ${pl.title}`}
                    className="press w-10 h-10 rounded-full grid place-items-center bg-accent text-white disabled:opacity-40"
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" strokeWidth={0} />
                  </button>
                  <button
                    type="button"
                    onClick={() => music.disable(pl.id)}
                    aria-label={`Retirer ${pl.title} de l'appareil`}
                    className="press w-10 h-10 rounded-full grid place-items-center text-muted hover:text-accent-text hover:bg-surface3"
                  >
                    <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.9} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {entries.length > 0 && playlists.length > 0 && (
        <h2 className="mb-3 text-lg font-bold tracking-[-0.01em]">Vidéos</h2>
      )}

      {entries.length > 0 ? (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => {
            const m = entry.media;
            const active = entry.state === "preparing" || entry.state === "downloading";
            const quality = OFFLINE_QUALITIES.find((q) => q.id === entry.quality)?.label ?? entry.quality;
            return (
              <div key={entry.id} className="flex items-center gap-3.5 p-2 -mx-2 rounded-[18px] hover:bg-card transition-colors">
                <button
                  type="button"
                  disabled={entry.state !== "done"}
                  onClick={() => onPlay(entry)}
                  className="relative w-[120px] sm:w-[160px] aspect-video rounded-[14px] overflow-hidden bg-card flex-shrink-0 disabled:cursor-default"
                  aria-label={`Lire ${displayTitle(m)}`}
                >
                  <img src={m.art || m.thumb || m.grandparentThumb || ""} alt="" loading="lazy" className="w-full h-full object-cover" />
                  {entry.state === "done" && (
                    <span className="absolute inset-0 grid place-items-center bg-black/25">
                      <span className="w-10 h-10 rounded-full bg-black/45 backdrop-blur-md grid place-items-center text-white">
                        <Play className="w-4 h-4 fill-current ml-0.5" strokeWidth={0} />
                      </span>
                    </span>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold truncate">{displayTitle(m)}</div>
                  <div className="mt-0.5 text-[13px] text-muted truncate">
                    {m.type === "episode" ? `${episodeCode(m)} · ${m.title}` : formatRuntime(m.durationMinutes) || "Film"}
                  </div>
                  <div className={`mt-1 text-xs ${entry.state === "error" ? "text-accent-text" : "text-muted"}`}>
                    {entry.state === "done"
                      ? `${quality}${entry.size ? ` · ${formatBytes(entry.size)}` : ""}`
                      : entry.state === "error"
                      ? `Échec : ${entry.error || "erreur inconnue"}`
                      : `${downloadLabel(entry)} · ${quality}`}
                  </div>
                  {active && (
                    <div className="mt-2 h-1 rounded-full bg-line2 overflow-hidden max-w-[260px]">
                      <div
                        className="h-full bg-accent transition-[width] duration-500"
                        style={{ width: `${Math.round(entry.progress * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                {entry.state === "error" && (
                  <button
                    type="button"
                    onClick={() => retry(entry.id)}
                    aria-label={`Réessayer ${displayTitle(m)}`}
                    className="press w-10 h-10 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-surface3"
                  >
                    <RotateCw className="w-[18px] h-[18px]" strokeWidth={1.9} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(entry.id)}
                  aria-label={`Supprimer ${displayTitle(m)} de l'appareil`}
                  className="press w-10 h-10 rounded-full grid place-items-center text-muted hover:text-accent-text hover:bg-surface3"
                >
                  <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.9} />
                </button>
              </div>
            );
          })}
        </div>
      ) : playlists.length > 0 ? null : (
        <div className="py-16 px-5 text-center flex flex-col items-center">
          <div className="w-[88px] h-[88px] rounded-[28px] bg-card grid place-items-center">
            <Download className="w-[38px] h-[38px] text-muted" strokeWidth={1.6} />
          </div>
          <h2 className="mt-[22px] text-2xl font-bold tracking-[-0.02em]">Aucun téléchargement</h2>
          <p className="mt-2 max-w-[400px] text-[15px] leading-relaxed text-muted">
            Téléchargez un film, des épisodes ou une playlist sur le Wi-Fi pour en profiter ensuite sans connexion, sans aucune coupure.
          </p>
          <button
            type="button"
            onClick={onExplore}
            className="press mt-[22px] h-12 px-6 rounded-full bg-accent hover:bg-accent-hover text-white font-semibold"
          >
            Explorer le catalogue
          </button>
        </div>
      )}
    </div>
  );
};
