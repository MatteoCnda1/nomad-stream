import React, { useEffect, useState } from "react";
import { HubData, MediaItem } from "../types";
import { fetchHubs, prefetchMetadata } from "../api";
import { Plus, Check, Flame, Sparkles } from "lucide-react";
import { useWishlist } from "../context/WishlistContext";
import { MusicTile, PlayGlyph, PosterCard, SectionHeader, Sk } from "../components/ui";
import { displayTitle, episodeCode, formatRuntime, resumeSubtitle } from "../utils/format";

export type HomeFilter = "all" | "films" | "series" | "music";

interface HomeViewProps {
  filter: HomeFilter;
  onPlayMedia: (item: MediaItem) => void;
  onOpenMovie: (movieId: string) => void;
  onOpenShow: (showId: string) => void;
  onOpenAlbum: (albumId: string) => void;
  onNavigate: (tab: string) => void;
}

// Rangée défilante sur mobile, grille sur desktop
const ROW = "flex gap-3.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 lg:grid lg:overflow-visible";
// Sur desktop, une seule ligne : les éléments au-delà du nombre de colonnes sont masqués
const POSTER_ROW = `${ROW} lg:gap-[18px] lg:grid-cols-4 xl:grid-cols-5 lg:max-xl:[&>*:nth-child(n+5)]:hidden xl:[&>*:nth-child(n+6)]:hidden`;
const RESUME_ROW = `${ROW} lg:gap-[18px] lg:grid-cols-3 xl:grid-cols-4 lg:max-xl:[&>*:nth-child(n+4)]:hidden xl:[&>*:nth-child(n+5)]:hidden`;
const MUSIC_ROW = `${ROW} gap-1 lg:gap-2 lg:-mx-2.5 lg:grid-cols-4 xl:grid-cols-6 lg:max-xl:[&>*:nth-child(n+5)]:hidden xl:[&>*:nth-child(n+7)]:hidden`;

const HomeSkeleton: React.FC = () => (
  <div aria-busy="true" aria-label="Chargement du contenu" className="pt-1">
    <div className="lg:hidden grid grid-cols-2 gap-2 mb-[22px]">
      {[0, 1, 2, 3].map((i) => <Sk key={i} className="h-14 rounded-xl" />)}
    </div>
    <Sk className="h-[400px] lg:h-[380px] rounded-[26px] lg:rounded-3xl" />
    <Sk className="mt-10 w-[220px] h-6 rounded-lg" />
    <div className="mt-[18px] grid grid-cols-2 xl:grid-cols-4 gap-[18px]">
      {[80, 70, 85, 65].map((w, i) => (
        <div key={i} className={i > 1 ? "hidden xl:block" : ""}>
          <Sk className="aspect-video rounded-2xl" />
          <Sk className="mt-3 h-3.5 rounded-md" style={{ width: `${w}%` }} />
          <Sk className="mt-2 h-3 w-1/2 rounded-md" />
        </div>
      ))}
    </div>
    <Sk className="mt-10 w-[180px] h-6 rounded-lg" />
    <div className="mt-[18px] grid grid-cols-3 xl:grid-cols-6 gap-2">
      {[75, 60, 80, 70, 55, 65].map((w, i) => (
        <div key={i} className={`p-2.5 ${i > 2 ? "hidden xl:block" : ""}`}>
          <Sk className="aspect-square rounded-[14px]" />
          <Sk className="mt-3 h-3.5 rounded-md" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  </div>
);

export const HomeView: React.FC<HomeViewProps> = ({
  filter,
  onPlayMedia,
  onOpenMovie,
  onOpenShow,
  onOpenAlbum,
  onNavigate,
}) => {
  const [data, setData] = useState<HubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const { isSaved, toggle } = useWishlist();

  useEffect(() => {
    fetchHubs()
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => setHeroIndex(0), [filter]);

  if (loading) return <HomeSkeleton />;

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 text-center rounded-3xl bg-card">
        <p className="font-semibold text-accent-text mb-2">Impossible de charger le contenu</p>
        <p className="text-sm text-muted mb-5">{error || "Erreur inconnue"}</p>
        <button
          onClick={() => window.location.reload()}
          className="press h-12 px-6 rounded-full bg-accent hover:bg-accent-hover text-white font-semibold"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const showMovies = filter === "all" || filter === "films";
  const showShows = filter === "all" || filter === "series";
  const showMusic = filter === "all" || filter === "music";

  const onDeck = data.onDeck.filter((i) =>
    filter === "films" ? i.type === "movie" : filter === "series" ? i.type === "episode" : filter !== "music"
  );

  // Héros : reprises en cours puis nouveautés de la catégorie
  const heroes = [
    ...onDeck,
    ...(showMovies ? data.recentMovies : []),
    ...(showShows ? data.recentShows : []),
  ]
    .filter((i) => i.art || i.thumb)
    .slice(0, 4);
  const hero = filter === "music" ? undefined : heroes[Math.min(heroIndex, heroes.length - 1)];

  const openItem = (item: MediaItem) => {
    if (item.type === "show") onOpenShow(item.id);
    else if (item.type === "movie" && !item.progressPercent) onOpenMovie(item.id);
    else onPlayMedia(item);
  };

  // Tuiles rapides (mobile) : un raccourci vers chaque type de contenu récent
  const quick = [data.recentMusic[0], data.recentShows[0], data.recentMusic[1], data.recentMovies[0]].filter(
    Boolean
  ) as MediaItem[];
  const openQuick = (item: MediaItem) =>
    item.type === "album" ? onOpenAlbum(item.id) : item.type === "show" ? onOpenShow(item.id) : onOpenMovie(item.id);

  // Les éléments qui lanceront directement la lecture : métadonnées préchargées dès le toucher
  const willPlay = (item: MediaItem) => item.type === "episode" || (item.type === "movie" && item.progressPercent > 0);

  const heroBadge = (item: MediaItem) => {
    if (item.progressPercent > 0) return item.type === "episode" ? `Reprendre · ${episodeCode(item)}` : "Reprendre";
    return item.type === "show" ? "Nouvelle série" : item.type === "episode" ? "Épisode suivant" : "Nouveau film";
  };

  const heroMeta = (item: MediaItem) =>
    [
      item.year ? String(item.year) : "",
      item.type === "episode" ? item.title : item.type === "movie" ? formatRuntime(item.durationMinutes) : "Série",
    ].filter(Boolean);

  const isEmpty =
    !hero && onDeck.length === 0 && data.recentMovies.length + data.recentShows.length + data.recentMusic.length === 0;

  return (
    <div key={filter} className="anim-in pt-1">
      {filter === "all" && quick.length > 0 && (
        <div className="lg:hidden grid grid-cols-2 gap-2 mb-[22px]">
          {quick.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => openQuick(q)}
              className="press flex items-center gap-2.5 h-14 pr-2.5 rounded-xl bg-card overflow-hidden text-left"
            >
              <img src={q.thumb || "/icon.svg"} alt="" loading="lazy" className="w-14 h-14 object-cover flex-shrink-0" />
              <span className="text-[13px] font-semibold leading-tight line-clamp-2">{q.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* HERO */}
      {hero && (
        <section
          aria-label="À la une"
          className="relative h-[400px] lg:h-[380px] rounded-[26px] lg:rounded-3xl overflow-hidden bg-[#08080c] text-white"
        >
          <img
            key={hero.id}
            src={hero.art || hero.thumb || ""}
            alt=""
            decoding="async"
            className="anim-in absolute inset-0 w-full h-full object-cover object-[68%_50%]"
          />
          <div className="absolute inset-0 lg:hidden bg-gradient-to-b from-black/10 from-30% to-black/90" />
          <div
            className="absolute inset-0 hidden lg:block"
            style={{ background: "linear-gradient(90deg, rgba(6,6,9,.92) 0%, rgba(6,6,9,.55) 45%, rgba(6,6,9,0) 75%)" }}
          />

          <div className="relative h-full p-5 lg:px-9 lg:py-8 flex flex-col justify-between lg:justify-end lg:max-w-[560px]">
            <span className="self-start inline-flex items-center gap-2 px-3 lg:px-3.5 py-1.5 lg:py-[7px] rounded-full bg-white/[.14] backdrop-blur-md text-xs lg:text-[13px] font-medium">
              {hero.progressPercent > 0 ? (
                <Flame className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-[#ff4d55] fill-current" />
              ) : (
                <Sparkles className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-[#ff4d55]" />
              )}
              {heroBadge(hero)}
            </span>

            <div>
              <h1 className="lg:mt-4 text-[32px] lg:text-[46px] leading-none tracking-[-0.035em] font-bold line-clamp-2">
                {displayTitle(hero)}
              </h1>
              <div className="mt-2 lg:mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] lg:text-sm text-white/80">
                {heroMeta(hero).map((m, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span aria-hidden="true">·</span>}
                    <span className="truncate max-w-[260px]">{m}</span>
                  </React.Fragment>
                ))}
                {hero.contentRating && (
                  <span className="px-[7px] py-0.5 border border-white/40 rounded-md text-xs">{hero.contentRating}</span>
                )}
              </div>
              {hero.summary && (
                <p className="hidden lg:block mt-3 text-[15px] leading-relaxed text-white/[.78] line-clamp-2">
                  {hero.summary}
                </p>
              )}
              <div className="mt-4 lg:mt-[22px] flex gap-2 lg:gap-2.5">
                <button
                  type="button"
                  onClick={() => openItem(hero)}
                  onPointerDown={() => willPlay(hero) && prefetchMetadata(hero.id)}
                  className="press flex-1 lg:flex-none h-12 px-6 rounded-full bg-accent text-white lg:bg-white lg:text-[#111] inline-flex items-center justify-center gap-2.5 font-semibold"
                >
                  <PlayGlyph className="w-4 h-4" />
                  {hero.progressPercent > 0 ? "Reprendre" : hero.type === "show" ? "Voir la série" : "Regarder"}
                </button>
                <button
                  type="button"
                  onClick={() => toggle(hero)}
                  aria-pressed={isSaved(hero.id)}
                  aria-label={isSaved(hero.id) ? "Retirer de ma liste" : "Ajouter à ma liste"}
                  className="press w-12 lg:w-auto h-12 lg:px-5 rounded-full lg:border lg:border-white/30 bg-white/[.14] lg:bg-white/10 backdrop-blur-md inline-flex items-center justify-center gap-2 font-medium"
                >
                  {isSaved(hero.id) ? <Check className="w-[18px] h-[18px]" strokeWidth={2.2} /> : <Plus className="w-[18px] h-[18px]" strokeWidth={2} />}
                  <span className="hidden lg:inline">{isSaved(hero.id) ? "Dans ma liste" : "Ma liste"}</span>
                </button>
              </div>
            </div>
          </div>

          {heroes.length > 1 && (
            <div
              className="absolute right-5 top-5 lg:right-6 lg:top-1/2 lg:-translate-y-1/2 flex lg:flex-col gap-2"
              role="tablist"
              aria-label="Choisir la une"
            >
              {heroes.map((h, i) => {
                const active = h.id === hero.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={displayTitle(h)}
                    onClick={() => setHeroIndex(i)}
                    className="p-1 -m-1"
                  >
                    <span
                      className={`block rounded-md transition-all duration-300 ${
                        active ? "w-7 h-1.5 lg:w-1.5 lg:h-7 bg-white" : "w-1.5 h-1.5 bg-white/40 hover:bg-white/70"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* REPRENDRE LA LECTURE */}
      {onDeck.length > 0 && (
        <section className="mt-7 lg:mt-9">
          <SectionHeader title="Reprendre la lecture" />
          <div className={RESUME_ROW}>
            {onDeck.slice(0, 12).map((item) => (
              <div key={item.id} className="flex-[0_0_230px] sm:flex-[0_0_280px] lg:flex-none">
                <button
                  type="button"
                  onClick={() => onPlayMedia(item)}
                  onPointerDown={() => prefetchMetadata(item.id)}
                  className="lift block w-full text-left"
                >
                  <div className="zoom relative aspect-video rounded-2xl bg-card">
                    <img
                      src={item.art || item.thumb || ""}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="z w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent from-55% to-black/60" />
                    <div className="absolute left-3 right-3 bottom-3 h-1 rounded bg-white/30">
                      <div className="h-full rounded bg-accent" style={{ width: `${item.progressPercent}%` }} />
                    </div>
                  </div>
                  <div className="mt-3 text-[15px] font-semibold truncate">{displayTitle(item)}</div>
                  <div className="mt-0.5 text-[13px] text-muted truncate">{resumeSubtitle(item)}</div>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* MUSIQUE */}
      {showMusic && data.recentMusic.length > 0 && (
        <section className={hero || onDeck.length > 0 ? "mt-8" : ""}>
          <SectionHeader title="Nouveautés musique" onAction={() => onNavigate("music")} className="mb-2" />
          <div className={MUSIC_ROW}>
            {data.recentMusic.slice(0, 12).map((album) => (
              <div key={album.id} className="flex-[0_0_160px] lg:flex-none">
                <MusicTile
                  img={album.thumb}
                  title={album.title}
                  sub={album.parentTitle || "Album"}
                  onClick={() => onOpenAlbum(album.id)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FILMS */}
      {showMovies && data.recentMovies.length > 0 && (
        <section className="mt-8">
          <SectionHeader title="Derniers films" onAction={() => onNavigate("movies")} />
          <div className={POSTER_ROW}>
            {data.recentMovies.slice(0, 12).map((movie) => (
              <div key={movie.id} className="flex-[0_0_148px] sm:flex-[0_0_170px] lg:flex-none">
                <PosterCard
                  img={movie.thumb}
                  title={movie.title}
                  meta={[movie.year, movie.genres[0]].filter(Boolean).join(" · ") || "Film"}
                  onClick={() => onOpenMovie(movie.id)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SÉRIES */}
      {showShows && data.recentShows.length > 0 && (
        <section className="mt-8">
          <SectionHeader title="Dernières séries" onAction={() => onNavigate("shows")} />
          <div className={POSTER_ROW}>
            {data.recentShows.slice(0, 12).map((show) => (
              <div key={show.id} className="flex-[0_0_148px] sm:flex-[0_0_170px] lg:flex-none">
                <PosterCard
                  img={show.thumb}
                  title={show.title}
                  meta={[show.year, show.genres[0]].filter(Boolean).join(" · ") || "Série"}
                  onClick={() => onOpenShow(show.id)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {isEmpty && (
        <p className="py-20 text-center text-muted">Rien à afficher dans cette catégorie pour le moment.</p>
      )}
    </div>
  );
};
