import React, { useEffect, useState } from "react";
import { MediaItem } from "../types";
import { fetchMovies } from "../api";
import { Star } from "lucide-react";
import { PosterCard } from "../components/ui";
import { LibraryHeader, POSTER_GRID, PosterGridSkeleton } from "../components/LibraryHeader";

interface MoviesViewProps {
  onOpenMovie: (movieId: string) => void;
}

export const MoviesView: React.FC<MoviesViewProps> = ({ onOpenMovie }) => {
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("titleSort:asc");

  useEffect(() => {
    setLoading(true);
    fetchMovies(0, 100, sort)
      .then((res) => {
        setMovies(res.items);
        setTotalSize(res.totalSize);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [sort]);

  return (
    <div>
      <LibraryHeader
        title="Films"
        subtitle={loading ? "Chargement…" : `${totalSize} films disponibles`}
        sort={sort}
        onSortChange={setSort}
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
    </div>
  );
};
