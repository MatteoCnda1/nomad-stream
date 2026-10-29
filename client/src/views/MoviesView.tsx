import React from "react";
import { fetchMovies } from "../api";
import { usePagedList } from "../hooks/usePagedList";
import { Star } from "lucide-react";
import { PosterCard } from "../components/ui";
import { LibraryHeader, LoadMore, POSTER_GRID, PosterGridSkeleton } from "../components/LibraryHeader";

interface MoviesViewProps {
  onOpenMovie: (movieId: string) => void;
  sort: string; // dans l'adresse (?tri=) : conservé au retour d'une fiche
  onSortChange: (sort: string) => void;
}

export const MoviesView: React.FC<MoviesViewProps> = ({ onOpenMovie, sort, onSortChange }) => {
  const list = usePagedList(`movies:${sort}`, (offset, limit) => fetchMovies(offset, limit, sort));
  const { items: movies, totalSize, loading } = list;

  return (
    <div>
      <LibraryHeader
        title="Films"
        subtitle={loading ? "Chargement…" : `${totalSize} films disponibles`}
        sort={sort}
        onSortChange={onSortChange}
      />

      {loading ? (
        <PosterGridSkeleton />
      ) : (
        <div className={`${POSTER_GRID} anim-in`}>
          {movies.map((movie) => (
            <PosterCard
              key={movie.id}
              img={movie.thumb}
              title={movie.title}
              meta={[movie.year, movie.genres[0]].filter(Boolean).join(" · ") || "Film"}
              onClick={() => onOpenMovie(movie.id)}
              progress={movie.progressPercent}
              badge={
                movie.rating ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-white text-[11px] font-semibold">
                    <Star className="w-3 h-3 text-[#ff4d55] fill-current" strokeWidth={0} />
                    {Number(movie.rating).toFixed(1).replace(".", ",")}
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      <LoadMore {...list} onLoadMore={list.loadMore} shown={movies.length} total={totalSize} />
    </div>
  );
};
