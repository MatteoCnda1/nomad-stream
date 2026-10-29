import React, { useState, useEffect } from "react";
import { SearchResults, MediaDetail } from "../types";
import { searchPlex } from "../api";
import { useAudio } from "../context/AudioContext";
import { useWishlist } from "../context/WishlistContext";
import { Search, X, ChevronLeft } from "lucide-react";
import { Pills, PosterCard, SectionHeader, Sk } from "../components/ui";
import { POSTER_GRID } from "../components/LibraryHeader";
import { TrackRow } from "../components/Collection";

interface SearchViewProps {
  query: string;
  setQuery: (q: string) => void;
  onClose: () => void;
  onPlayMedia: (item: MediaDetail) => void;
  onOpenMovie: (movieId: string) => void;
  onOpenShow: (showId: string) => void;
  onOpenAlbum: (albumId: string) => void;
}

type Filter = "all" | "movies" | "shows" | "tracks";

export const SearchView: React.FC<SearchViewProps> = ({
  query,
  setQuery,
  onClose,
  onOpenMovie,
  onOpenShow,
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
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const hasAnyResults =
    results &&
    (results.movies.length > 0 ||
      results.shows.length > 0 ||
      results.tracks.length > 0);

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
            Cherchez un film, une série, un artiste ou un titre dans votre médiathèque.
          </p>
        </div>
      )}

      {/* Filtres */}
      {results && query.trim() && (
        <Pills
          label="Filtrer les résultats"
          size="sm"
          className="mb-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "Tout" },
            { id: "movies", label: "Films", count: results.movies.length },
            { id: "shows", label: "Séries", count: results.shows.length },
            { id: "tracks", label: "Titres", count: results.tracks.length },
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
        <div className="text-center py-16 text-muted">Aucun résultat pour « {query} »</div>
      )}

      {results && query.trim() && (
        <div className={`space-y-9 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {(filter === "all" || filter === "movies") && results.movies.length > 0 && (
            <section>
              <SectionHeader title="Films" />
              <div className={POSTER_GRID}>
                {results.movies.map((m) => (
                  <PosterCard
                    key={m.id}
                    img={m.thumb}
                    title={m.title}
                    meta={m.year ? String(m.year) : "Film"}
                    onClick={() => onOpenMovie(m.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {(filter === "all" || filter === "shows") && results.shows.length > 0 && (
            <section>
              <SectionHeader title="Séries" />
              <div className={POSTER_GRID}>
                {results.shows.map((s) => (
                  <PosterCard
                    key={s.id}
                    img={s.thumb}
                    title={s.title}
                    meta={s.year ? String(s.year) : "Série"}
                    onClick={() => onOpenShow(s.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {(filter === "all" || filter === "tracks") && results.tracks.length > 0 && (
            <section>
              <SectionHeader title="Titres" />
              <div className="flex flex-col gap-0.5 -mx-3">
                {results.tracks.map((t, i) => (
                  <TrackRow
                    key={t.id}
                    track={{ ...t, trackNumber: undefined }}
                    index={i}
                    isCurrent={currentTrack?.id === t.id}
                    saved={isSaved(t.id)}
                    onPlay={() => playTrack(t, results.tracks, i)}
                    onToggleSaved={() => toggle(t)}
                    subtitle={[t.grandparentTitle, t.parentTitle].filter(Boolean).join(" · ")}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
