import React from "react";
import { fetchShows } from "../api";
import { usePagedList } from "../hooks/usePagedList";
import { PosterCard } from "../components/ui";
import { LibraryHeader, LoadMore, POSTER_GRID, PosterGridSkeleton } from "../components/LibraryHeader";

interface ShowsViewProps {
  onOpenShow: (showId: string) => void;
  sort: string; // dans l'adresse (?tri=) : conservé au retour d'une fiche
  onSortChange: (sort: string) => void;
}

export const ShowsView: React.FC<ShowsViewProps> = ({ onOpenShow, sort, onSortChange }) => {
  const list = usePagedList(`shows:${sort}`, (offset, limit) => fetchShows(offset, limit, sort));
  const { items: shows, totalSize, loading } = list;

  return (
    <div>
      <LibraryHeader
        title="Séries"
        subtitle={loading ? "Chargement…" : `${totalSize} séries disponibles`}
        sort={sort}
        onSortChange={onSortChange}
      />

      {loading ? (
        <PosterGridSkeleton />
      ) : (
        <div className={`${POSTER_GRID} anim-in`}>
          {shows.map((show) => (
            <PosterCard
              key={show.id}
              img={show.thumb}
              title={show.title}
              meta={[show.year, show.genres[0]].filter(Boolean).join(" · ") || "Série"}
              onClick={() => onOpenShow(show.id)}
            />
          ))}
        </div>
      )}
      <LoadMore {...list} onLoadMore={list.loadMore} shown={shows.length} total={totalSize} />
    </div>
  );
};
