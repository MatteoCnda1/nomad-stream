import React, { useEffect, useState } from "react";
import { MediaDetail } from "../types";
import { fetchMetadata } from "../api";
import { ChevronLeft, Plus, Check, Star } from "lucide-react";
import { useWishlist } from "../context/WishlistContext";
import { Avatar, PlayGlyph, Sk } from "../components/ui";
import { DownloadButton } from "../components/DownloadButton";
import { formatRuntime, remainingLabel, resolutionLabel } from "../utils/format";

interface MovieDetailViewProps {
  movieId: string;
  onBack: () => void;
  onPlayMedia: (item: MediaDetail) => void;
}

// En-tête plein cadre partagé par les fiches film et série
export const DetailHero: React.FC<{ img: string | null; onBack: () => void; backLabel: string }> = ({
  img,
  onBack,
  backLabel,
}) => (
  <div className="relative h-[420px] lg:h-[460px] -mx-4 sm:-mx-6 lg:mx-0 lg:rounded-3xl overflow-hidden bg-card">
    {img && <img src={img} alt="" decoding="async" className="anim-in w-full h-full object-cover object-[70%_50%]" />}
    <div
      className="absolute inset-0"
      style={{ background: "linear-gradient(180deg, rgba(0,0,0,.35) 0%, rgba(0,0,0,0) 30%, rgb(var(--panel)) 94%)" }}
    />
    <button
      type="button"
      onClick={onBack}
      aria-label={backLabel}
      className="press absolute left-4 lg:left-5 top-[max(18px,env(safe-area-inset-top))] lg:top-5 w-11 h-11 rounded-full bg-black/35 backdrop-blur-md text-white grid place-items-center"
    >
      <ChevronLeft className="w-[22px] h-[22px]" strokeWidth={2} />
    </button>
  </div>
);

export const DetailSkeleton: React.FC = () => (
  <div aria-busy="true" aria-label="Chargement">
    <Sk className="h-[420px] lg:h-[460px] -mx-4 sm:-mx-6 lg:mx-0 lg:rounded-3xl" />
    <div className="lg:px-9 -mt-16 relative max-w-3xl">
      <Sk className="h-9 w-2/3 rounded-lg" />
      <Sk className="mt-4 h-4 w-1/2 rounded-md" />
      <Sk className="mt-6 h-[52px] rounded-2xl" />
      <Sk className="mt-6 h-4 rounded-md" />
      <Sk className="mt-2 h-4 w-5/6 rounded-md" />
    </div>
  </div>
);

export const ExpandableSummary: React.FC<{ text: string }> = ({ text }) => {
  const [more, setMore] = useState(false);
  const long = text.length > 220;
  return (
    <>
      <p className={`mt-5 text-[15px] leading-relaxed text-muted ${!more && long ? "line-clamp-3" : ""}`}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setMore(!more)}
          aria-expanded={more}
          className="mt-1.5 py-1.5 text-sm font-semibold"
        >
          {more ? "Réduire" : "Lire la suite"}
        </button>
      )}
    </>
  );
};

export const OutlineButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = "", ...props }) => (
  <button
    type="button"
    {...props}
    className={`press h-12 px-4 rounded-[14px] border border-line2 hover:bg-card flex items-center justify-center gap-2 text-sm font-medium ${className}`}
  />
);

export const MovieDetailView: React.FC<MovieDetailViewProps> = ({ movieId, onBack, onPlayMedia }) => {
  const [movie, setMovie] = useState<MediaDetail | null>(null);
  const [tab, setTab] = useState<"cast" | "tech">("cast");
  const { isSaved, toggle } = useWishlist();

  useEffect(() => {
    setMovie(null);
    fetchMetadata(movieId).then(setMovie).catch(console.error);
  }, [movieId]);

  if (!movie) return <DetailSkeleton />;

  const saved = isSaved(movie.id);
  const resolution = resolutionLabel(movie.videoResolution);
  const tabs = [
    { id: "cast" as const, label: "Distribution" },
    { id: "tech" as const, label: "Infos techniques" },
  ];
  const techRows = [
    ["Vidéo", [resolution, movie.videoCodec?.toUpperCase()].filter(Boolean).join(" · ")],
    ["Audio", movie.audioCodec?.toUpperCase() || ""],
    ["Conteneur", movie.container?.toUpperCase() || ""],
    ["Pistes audio", movie.audioStreams.map((s) => s.language || s.title).filter(Boolean).join(", ")],
    ["Sous-titres", movie.subtitleStreams.map((s) => s.language || s.title).filter(Boolean).join(", ")],
    ["Studio", movie.studio || ""],
  ].filter(([, v]) => v);

  return (
    <div className="anim-in">
      <DetailHero img={movie.art || movie.thumb} onBack={onBack} backLabel="Retour" />

      <div className="lg:px-9 -mt-16 relative max-w-3xl">
        <h1 className="text-[34px] lg:text-[46px] font-bold tracking-[-0.035em] leading-none">{movie.title}</h1>
        {movie.tagline && <p className="mt-2 text-[15px] text-muted italic">{movie.tagline}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-muted">
          {movie.rating != null && (
            <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md bg-accent text-white text-[13px] font-semibold">
              <Star className="w-3 h-3 fill-current" strokeWidth={0} />
              {Number(movie.rating).toFixed(1).replace(".", ",")}
            </span>
          )}
          {[movie.year, formatRuntime(movie.durationMinutes)].filter(Boolean).map((m, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span aria-hidden="true">·</span>}
              <span>{m}</span>
            </React.Fragment>
          ))}
          {movie.contentRating && (
            <span className="px-1.5 py-px border border-line2 rounded-[5px] text-xs">{movie.contentRating}</span>
          )}
          {resolution && <span>{resolution}</span>}
        </div>

        {movie.genres.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {movie.genres.map((g) => (
              <span key={g} className="px-[11px] py-[5px] rounded-full bg-card text-[13px]">{g}</span>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={() => onPlayMedia(movie)}
            className="press sm:px-8 h-[52px] rounded-2xl bg-accent hover:bg-accent-hover text-white inline-flex items-center justify-center gap-2.5 font-semibold text-base"
          >
            <PlayGlyph className="w-4 h-4" />
            {movie.progressPercent > 0 ? "Reprendre" : "Regarder"}
          </button>
          <div className="grid grid-cols-2 sm:flex gap-2">
            <OutlineButton
              onClick={() => toggle(movie)}
              aria-pressed={saved}
              className={`sm:h-[52px] sm:px-5 ${saved ? "text-accent-text" : ""}`}
            >
              {saved ? <Check className="w-[18px] h-[18px]" strokeWidth={2.2} /> : <Plus className="w-[18px] h-[18px]" strokeWidth={2} />}
              Ma liste
            </OutlineButton>
            <DownloadButton media={movie} className="sm:h-[52px] sm:px-5" />
          </div>
        </div>

        {movie.progressPercent > 0 && (
          <div className="mt-4 flex items-center gap-3 text-[13px] text-muted">
            <div className="flex-1 max-w-[240px] h-1 rounded bg-line2">
              <div className="h-full rounded bg-accent" style={{ width: `${movie.progressPercent}%` }} />
            </div>
            {remainingLabel(movie)}
          </div>
        )}

        {movie.summary && <ExpandableSummary text={movie.summary} />}
        {movie.directors.length > 0 && (
          <div className="mt-1 text-[13px] text-muted">Réalisation : {movie.directors.join(", ")}</div>
        )}

        {/* Onglets */}
        <div role="tablist" aria-label="Sections" className="mt-[22px] flex gap-[22px] border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`relative py-3 text-[15px] font-semibold transition-colors ${tab === t.id ? "text-fg" : "text-muted hover:text-fg"}`}
            >
              {t.label}
              <span
                className={`absolute left-0 right-0 -bottom-px h-0.5 rounded bg-accent transition-transform duration-300 ease-out origin-left ${
                  tab === t.id ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          ))}
        </div>

        {tab === "cast" && (
          <div key="cast" className="anim-in mt-[18px] -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 flex gap-3 overflow-x-auto no-scrollbar">
            {movie.roles.length > 0 ? (
              movie.roles.map((name) => (
                <div key={name} className="flex-[0_0_104px] px-2.5 py-3.5 rounded-[18px] bg-card text-center">
                  <Avatar name={name} size={56} className="mx-auto !text-lg" />
                  <div className="mt-2.5 text-[13px] font-semibold leading-tight">{name}</div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">Distribution non renseignée.</p>
            )}
          </div>
        )}

        {tab === "tech" && (
          <dl key="tech" className="anim-in mt-[18px] rounded-[20px] bg-card px-4">
            {techRows.map(([k, v], i) => (
              <div key={k} className={`flex justify-between gap-6 py-3 text-sm ${i > 0 ? "border-t border-line" : ""}`}>
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
};
