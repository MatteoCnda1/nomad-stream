import React, { useEffect, useState } from "react";
import { MediaItem } from "../types";
import { fetchShows } from "../api";
import { PosterCard } from "../components/ui";
import { LibraryHeader, POSTER_GRID, PosterGridSkeleton } from "../components/LibraryHeader";

interface ShowsViewProps {
  onOpenShow: (showId: string) => void;
  sort: string; // dans l'adresse (?tri=) : conservé au retour d'une fiche
  onSortChange: (sort: string) => void;
}

export const ShowsView: React.FC<ShowsViewProps> = ({ onOpenShow, sort, onSortChange }) => {
  const [shows, setShows] = useState<MediaItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchShows(0, 100, sort)
      .then((res) => {
        setShows(res.items);
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
    </div>
  );
};
