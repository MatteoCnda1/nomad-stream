import React, { useState, useEffect } from "react";
import { SearchResults, MediaDetail, MediaItem } from "../types";
import { searchPlex } from "../api";
import { useAudio } from "../context/AudioContext";
import { useWishlist } from "../context/WishlistContext";
import { Search, X, ChevronLeft } from "lucide-react";
import { MusicTile, Pills, PlayGlyph, PosterCard, SectionHeader, Sk } from "../components/ui";
import { POSTER_GRID, TILE_GRID } from "../components/LibraryHeader";
import { TrackRow } from "../components/Collection";

interface SearchViewProps {
  query: string;
  setQuery: (q: string) => void;
  onClose: () => void;
  onPlayMedia: (item: MediaDetail) => void;
  onOpenMovie: (movieId: string) => void;
  onOpenShow: (showId: string) => void;
  onOpenAlbum: (albumId: string) => void;
  onOpenArtist: (artist: MediaItem) => void;
}

type Group = "artists" | "albums" | "tracks" | "movies" | "shows";
type Filter = "all" | Group;

const LABELS: Record<Group, string> = {
  artists: "Artistes",
  albums: "Albums",
  tracks: "Titres",
  movies: "Films",
  shows: "Séries",
};

// Éléments affichés par section dans « Tout » (la suite via « Tout afficher »)
const PREVIEW: Record<Group, number> = { artists: 6, albums: 6, tracks: 5, movies: 10, shows: 10 };

const TYPE_LABEL: Record<MediaItem["type"], string> = {
  artist: "Artiste",
  album: "Album",
  track: "Titre",
  movie: "Film",
  show: "Série",
  episode: "Épisode",
};

const trackSubtitle = (t: MediaItem) => [t.grandparentTitle, t.parentTitle].filter(Boolean).join(" · ");

// Meilleur résultat, tous types confondus : grande vignette, type et artiste
const TopResult: React.FC<{ item: MediaItem; onOpen: () => void }> = ({ item, onOpen }) => {
  const isVideo = item.type === "movie" || item.type === "show";
  const sub =
    item.type === "album" ? item.parentTitle :
    item.type === "track" ? item.grandparentTitle :
    isVideo && item.year ? String(item.year) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tile group flex-1 w-full text-left p-5 rounded-3xl bg-card hover:bg-surface3 transition-colors flex flex-col gap-5"
    >
      <img
        src={item.thumb || "/icon.svg"}
        alt=""
        decoding="async"
        className={`object-cover bg-surface shadow-[0_18px_36px_-18px_rgba(0,0,0,.6)] ${
          isVideo ? "w-[92px] aspect-[2/3] rounded-xl" : `w-[108px] h-[108px] ${item.type === "artist" ? "rounded-full" : "rounded-xl"}`
        }`}
      />
      <div className="flex items-end justify-between gap-3 mt-auto">
        <div className="min-w-0">
          <div className="text-[26px] lg:text-[30px] leading-tight font-bold tracking-[-0.03em] line-clamp-2">{item.title}</div>
          <div className="mt-2 flex items-center gap-2 text-sm text-muted min-w-0">
            <span className="px-2.5 py-0.5 rounded-full border border-line2 text-fg text-[13px] font-semibold flex-shrink-0">
              {TYPE_LABEL[item.type]}
            </span>
            {sub && <span className="truncate">{sub}</span>}
          </div>
        </div>
        <span className="fab flex-shrink-0 w-12 h-12 rounded-full bg-accent grid place-items-center shadow-[0_10px_24px_-6px_rgba(229,19,29,.6)]">
          <PlayGlyph className="w-[18px] h-[18px] text-white ml-0.5" />
        </span>
      </div>
    </button>
  );
};

export const SearchView: React.FC<SearchViewProps> = ({
  query,
  setQuery,
  onClose,
  onOpenMovie,
  onOpenShow,
  onOpenAlbum,
  onOpenArtist,
}) => {
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const { playTrack, currentTrack } = useAudio();
  const { isSaved, toggle } = useWishlist();

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchPlex(query.trim());
        setResults(res);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Sections dans l'ordre de leur meilleur résultat (un artiste cherché passe avant les films)
  const groups: Group[] = results
    ? (Object.keys(LABELS) as Group[])
        .filter((g) => results[g].length > 0)
        .sort((a, b) => (results[b][0].score ?? 0) - (results[a][0].score ?? 0))
    : [];
  const hasAnyResults = groups.length > 0;
  // Filtre devenu vide après une nouvelle frappe : retour à « Tout »
  const active: Filter = filter !== "all" && !groups.includes(filter) ? "all" : filter;

  const open = (item: MediaItem) => {
    switch (item.type) {
      case "artist": return onOpenArtist(item);
      case "album": return onOpenAlbum(item.id);
      case "movie": return onOpenMovie(item.id);
      case "show": return onOpenShow(item.id);
      case "track": {
        const tracks = results?.tracks ?? [item];
        const i = tracks.findIndex((t) => t.id === item.id);
        return i >= 0 ? playTrack(item, tracks, i) : playTrack(item, [item], 0);
      }
    }
  };

  const section = (g: Group) => {
    if (!results) return null;
    const all = results[g];
    const items = active === "all" ? all.slice(0, PREVIEW[g]) : all;
    const header = (
      <SectionHeader
        title={LABELS[g]}
        onAction={active === "all" && all.length > items.length ? () => setFilter(g) : undefined}
      />
    );
    if (g === "tracks") {
      return (
        <section key={g}>
          {header}
          <div className="flex flex-col gap-0.5 -mx-3">
            {items.map((t, i) => (
              <TrackRow
                key={t.id}
                track={{ ...t, trackNumber: undefined }}
                index={i}
                isCurrent={currentTrack?.id === t.id}
                saved={isSaved(t.id)}
                onPlay={() => playTrack(t, all, i)}
                onToggleSaved={() => toggle(t)}
                subtitle={trackSubtitle(t)}
              />
            ))}
          </div>
        </section>
      );
    }
    if (g === "artists" || g === "albums") {
      return (
        <section key={g}>
          {header}
          <div className={TILE_GRID}>
            {items.map((m) => (
              <MusicTile
                key={m.id}
                img={m.thumb}
                title={m.title}
                sub={g === "artists" ? "Artiste" : [m.parentTitle, m.year].filter(Boolean).join(" · ") || "Album"}
                round={g === "artists"}
                onClick={() => open(m)}
              />
            ))}
          </div>
        </section>
      );
    }
    return (
      <section key={g}>
        {header}
        <div className={POSTER_GRID}>
          {items.map((m) => (
            <PosterCard
              key={m.id}
              img={m.thumb}
              title={m.title}
              meta={m.year ? String(m.year) : LABELS[g].slice(0, -1)}
              onClick={() => open(m)}
            />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="pt-[max(18px,env(safe-area-inset-top))] lg:pt-1">
      {/* Barre de recherche (mobile — sur desktop elle est dans la barre du haut) */}
      <div className="lg:hidden flex items-center gap-2 mb-5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la recherche"
          className="press w-11 h-11 rounded-full bg-surface grid place-items-center flex-shrink-0"
        >
          <ChevronLeft className="w-[22px] h-[22px]" strokeWidth={2} />
        </button>
        <div className="relative flex-1">
          <label className="sr-only" htmlFor="mobile-search">Rechercher</label>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted pointer-events-none" strokeWidth={2} />
          <input
            id="mobile-search"
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Films, séries, artistes, titres…"
            className="w-full h-12 pl-11 pr-11 rounded-full border border-line bg-surface text-[15px] placeholder:text-faint outline-none focus:border-line2"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Effacer"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center text-muted hover:text-fg"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {!query.trim() && (
        <div className="py-16 lg:py-24 text-center flex flex-col items-center">
          <div className="w-[88px] h-[88px] rounded-[28px] bg-card grid place-items-center">
            <Search className="w-[38px] h-[38px] text-muted" strokeWidth={1.6} />
          </div>
          <h1 className="mt-[22px] text-2xl font-bold tracking-[-0.02em]">Que voulez-vous regarder ?</h1>
          <p className="mt-2 max-w-[380px] text-[15px] leading-relaxed text-muted">
            Cherchez un film, une série, un artiste, un album ou un titre. Les fautes de frappe sont tolérées.
          </p>
        </div>
      )}

      {/* Filtres */}
      {results && query.trim() && hasAnyResults && (
        <Pills
          label="Filtrer les résultats"
          size="sm"
          className="mb-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
          value={active}
          onChange={setFilter}
          options={[
            { id: "all" as Filter, label: "Tout" },
            ...groups.map((g) => ({ id: g as Filter, label: LABELS[g], count: results[g].length })),
          ]}
        />
      )}

      {/* Chargement */}
      {loading && !results && (
        <div className={POSTER_GRID} aria-busy="true" aria-label="Recherche en cours">
          {Array.from({ length: 6 }, (_, i) => <Sk key={i} className="aspect-[2/3] rounded-[18px]" />)}
        </div>
      )}

      {/* Aucun résultat */}
      {!loading && query.trim() && results && !hasAnyResults && (
        <div role="status" className="text-center py-16 text-muted">Aucun résultat pour « {query} »</div>
      )}

      {results && query.trim() && hasAnyResults && (
        <div className={`space-y-9 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {active === "all" ? (
            <>
              {/* Meilleur résultat, et les premiers titres à côté */}
              {results.top && (
                <div className="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <section className="flex flex-col">
                    <SectionHeader title="Meilleur résultat" />
                    <TopResult item={results.top} onOpen={() => open(results.top!)} />
                  </section>
                  {results.tracks.length > 0 && section("tracks")}
                </div>
              )}
              {groups.filter((g) => !(results.top && g === "tracks")).map(section)}
            </>
          ) : (
            section(active)
          )}
        </div>
      )}
    </div>
  );
};
