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

export const PosterGridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => (
  <div className={POSTER_GRID} aria-busy="true" aria-label="Chargement">
    {Array.from({ length: count }, (_, i) => (
      <Sk key={i} className="aspect-[2/3] rounded-[18px]" />
    ))}
  </div>
);
