import React, { useEffect, useState } from "react";
import { ShowDetail, MediaItem } from "../types";
import { fetchShowDetail, prefetchMetadata } from "../api";
import { Plus, Check } from "lucide-react";
import { useWishlist } from "../context/WishlistContext";
import { PlayGlyph, Pills } from "../components/ui";
import { EpisodeDownloadButton } from "../components/DownloadButton";
import { DetailHero, DetailSkeleton, ExpandableSummary, OutlineButton } from "./MovieDetailView";
import { episodeCode, formatRuntime } from "../utils/format";

interface ShowDetailViewProps {
  showId: string;
  onBack: () => void;
  onPlayMedia: (item: MediaItem) => void;
}

export const ShowDetailView: React.FC<ShowDetailViewProps> = ({
  showId,
  onBack,
  onPlayMedia,
}) => {
  const [detail, setDetail] = useState<ShowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(1);
  const { isSaved, toggle } = useWishlist();

  useEffect(() => {
    fetchShowDetail(showId)
      .then((data) => {
        setDetail(data);
        if (data.seasons.length > 0) {
          setSelectedSeasonNumber(data.seasons[0].seasonNumber);
        }
        setLoading(false);
        // Précharger l'épisode que "Regarder" lancera
        const next = data.episodes.find((ep) => ep.progressPercent > 0) || data.episodes[0];
        if (next) prefetchMetadata(next.id);
      })
      .catch((err) => {
        console.error(err);
        setError(true);
        setLoading(false);
      });
  }, [showId]);

  if (error) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 text-center rounded-3xl bg-card">
        <p className="font-semibold text-accent-text mb-2">Impossible d'ouvrir cette série</p>
        <p className="text-sm text-muted mb-5">Le serveur Plex n'a pas renvoyé ses saisons.</p>
        <button
          type="button"
          onClick={onBack}
          className="press h-12 px-6 rounded-full bg-accent hover:bg-accent-hover text-white font-semibold"
        >
          Retour
        </button>
      </div>
    );
  }

  if (loading || !detail) return <DetailSkeleton />;

  const { show, seasons, episodes } = detail;
  const currentEpisodes = episodes.filter((ep) => ep.seasonNumber === selectedSeasonNumber);
  // Épisode à lancer : celui en cours, sinon le tout premier
  const nextEpisode = episodes.find((ep) => ep.progressPercent > 0) || episodes[0];
  const saved = isSaved(show.id);

  const handlePlayEpisode = (ep: MediaItem) => onPlayMedia(ep);

  return (
    <div className="anim-in">
      <DetailHero img={show.art || show.thumb} onBack={onBack} backLabel="Retour aux séries" />

      <div className="lg:px-9 -mt-16 relative max-w-4xl">
        <h1 className="text-[34px] lg:text-[46px] font-bold tracking-[-0.035em] leading-none">{show.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-muted">
          {show.year && <span>{show.year}</span>}
          {show.year && <span aria-hidden="true">·</span>}
          <span>
            {seasons.length} {seasons.length > 1 ? "saisons" : "saison"}
          </span>
          {show.contentRating && (
            <span className="px-1.5 py-px border border-line2 rounded-[5px] text-xs">{show.contentRating}</span>
          )}
          {show.studio && (
            <>
              <span aria-hidden="true">·</span>
              <span>{show.studio}</span>
            </>
          )}
        </div>

        {show.genres.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {show.genres.map((g) => (
              <span key={g} className="px-[11px] py-[5px] rounded-full bg-card text-[13px]">{g}</span>
            ))}
          </div>
        )}

        <div className="mt-5 flex gap-2.5">
          {nextEpisode && (
            <button
              type="button"
              onClick={() => handlePlayEpisode(nextEpisode)}
              className="press flex-1 sm:flex-none sm:px-8 h-[52px] rounded-2xl bg-accent hover:bg-accent-hover text-white inline-flex items-center justify-center gap-2.5 font-semibold text-base"
            >
              <PlayGlyph className="w-4 h-4" />
              {nextEpisode.progressPercent > 0 ? "Reprendre" : "Regarder"}
              <span className="font-normal opacity-80">{episodeCode(nextEpisode)}</span>
            </button>
          )}
          <OutlineButton
            onClick={() => toggle(show)}
            aria-pressed={saved}
            className={`h-[52px] px-5 ${saved ? "text-accent-text" : ""}`}
          >
            {saved ? <Check className="w-[18px] h-[18px]" strokeWidth={2.2} /> : <Plus className="w-[18px] h-[18px]" strokeWidth={2} />}
            Ma liste
          </OutlineButton>
        </div>

        {show.summary && <ExpandableSummary text={show.summary} />}

        {/* Saisons */}
        {seasons.length > 0 && (
          <Pills
            label="Saisons"
            size="sm"
            className="mt-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
            value={String(selectedSeasonNumber)}
            onChange={(v) => setSelectedSeasonNumber(Number(v))}
            options={seasons.map((s) => ({ id: String(s.seasonNumber), label: s.title, count: s.episodeCount }))}
          />
        )}

        {/* Épisodes */}
        <div key={selectedSeasonNumber} className="anim-in mt-5 flex flex-col gap-1">
          {currentEpisodes.map((ep) => (
            <div key={ep.id} className="lift tile group flex items-center gap-2 p-2 -mx-2 rounded-[18px]">
              <button
                type="button"
                onClick={() => handlePlayEpisode(ep)}
                onPointerDown={() => prefetchMetadata(ep.id)}
                className="flex-1 min-w-0 flex items-center gap-3.5 lg:gap-5 text-left"
              >
                <div className="zoom relative w-[132px] sm:w-[180px] lg:w-[220px] aspect-video rounded-[14px] bg-card flex-shrink-0">
                  <img
                    src={ep.thumb || show.art || show.thumb || ""}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="z w-full h-full object-cover"
                  />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 backdrop-blur-md grid place-items-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <PlayGlyph className="w-3.5 h-3.5 ml-0.5" />
                  </span>
                  {ep.progressPercent > 0 && (
                    <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/25">
                      <div className="h-full bg-accent" style={{ width: `${ep.progressPercent}%` }} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted">
                    Épisode {ep.episodeNumber}
                    {ep.durationMinutes > 0 && ` · ${formatRuntime(ep.durationMinutes)}`}
                  </div>
                  <h3 className="mt-0.5 text-[15px] font-semibold truncate">{ep.title}</h3>
                  {ep.summary && (
                    <p className="hidden sm:block mt-1 text-[13px] leading-snug text-muted line-clamp-2">{ep.summary}</p>
                  )}
                </div>
              </button>
              <EpisodeDownloadButton episode={ep} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
