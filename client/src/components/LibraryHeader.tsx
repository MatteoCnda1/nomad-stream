import React from "react";
import { Sk } from "./ui";

// En-tête de bibliothèque : titre, compteur et tri
export const LibraryHeader: React.FC<{
  title: string;
  subtitle: string;
  sort?: string;
  onSortChange?: (sort: string) => void;
}> = ({ title, subtitle, sort, onSortChange }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-1 mb-6">
    <div>
      <h1 className="text-[34px] lg:text-[40px] font-bold tracking-[-0.035em] leading-none">{title}</h1>
      <p className="mt-2 text-[15px] text-muted">{subtitle}</p>
    </div>
    {sort && onSortChange && (
      <label className="flex items-center gap-2 text-sm text-muted">
        Trier
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="h-10 px-3 rounded-xl border border-line2 bg-panel text-fg text-sm outline-none focus:border-fg/40"
        >
          <option value="titleSort:asc">Titre (A–Z)</option>
          <option value="addedAt:desc">Ajout récent</option>
          <option value="year:desc">Année (récent)</option>
          <option value="rating:desc">Meilleures notes</option>
        </select>
      </label>
    )}
  </div>
);

export const POSTER_GRID = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3.5 lg:gap-[18px]";

// Grille de tuiles musique (artistes, albums, playlists)
export const TILE_GRID = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-1 lg:gap-2 -mx-2.5";

// Pied d'une liste chargée par pages : repère qui déclenche la page suivante au défilement, et
// bouton de secours (clavier, lecteur d'écran, échec réseau)
export const LoadMore: React.FC<{
  sentinelRef: (node: HTMLElement | null) => void;
  hasMore: boolean;
  loadingMore: boolean;
  failed: boolean;
  onLoadMore: () => void;
  shown: number;
  total: number;
}> = ({ sentinelRef, hasMore, loadingMore, failed, onLoadMore, shown, total }) =>
  hasMore ? (
    <div ref={sentinelRef} className="mt-8 flex flex-col items-center gap-2.5">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loadingMore}
        className="press h-11 px-5 rounded-full border border-line2 text-sm font-medium hover:bg-card disabled:opacity-60"
      >
        {loadingMore ? "Chargement…" : failed ? "Réessayer" : "Afficher plus"}
      </button>
      <p className="text-xs text-muted" aria-live="polite">
        {shown} sur {total}
      </p>
    </div>
  ) : null;

export const PosterGridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => (
  <div className={POSTER_GRID} aria-busy="true" aria-label="Chargement">
    {Array.from({ length: count }, (_, i) => (
      <Sk key={i} className="aspect-[2/3] rounded-[18px]" />
    ))}
  </div>
);
