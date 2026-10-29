import React, { useEffect, useRef, useState } from "react";
import { Heart, LayoutGrid, List, Shuffle } from "lucide-react";
import { MediaItem } from "../types";
import { useWishlist, WishlistEntry } from "../context/WishlistContext";
import { useAudio } from "../context/AudioContext";
import { Pills } from "../components/ui";
import { BigPlayButton, CollectionHeader, MetaDot } from "../components/Collection";
import { formatDate, formatRuntime, formatTrackDuration, typeLabel } from "../utils/format";

interface WishlistViewProps {
  onOpenItem: (item: MediaItem) => void;
  onExplore: () => void;
}

type Filter = "all" | "films" | "series" | "music" | "tracks";
type Sort = "recent" | "title" | "type";

const KIND: Record<MediaItem["type"], Filter> = {
  movie: "films",
  show: "series",
  episode: "series",
  album: "music",
  artist: "music",
  track: "tracks",
};

const isAudio = (item: MediaItem) => KIND[item.type] === "music" || KIND[item.type] === "tracks";

function itemMeta(item: MediaItem): string {
  switch (item.type) {
    case "movie": return [item.genres[0], formatRuntime(item.durationMinutes)].filter(Boolean).join(" · ") || "Film";
    case "show": return [item.genres[0], item.year].filter(Boolean).join(" · ") || "Série";
    case "episode": return item.grandparentTitle || "Épisode";
    case "album": return [item.parentTitle, item.year].filter(Boolean).join(" · ") || "Album";
    case "artist": return "Artiste";
    case "track": return [item.grandparentTitle || item.parentTitle, formatTrackDuration(item.duration)].filter(Boolean).join(" · ");
  }
}

function itemDuration(item: MediaItem): string {
  if (item.type === "track") return formatTrackDuration(item.duration);
  if (item.type === "movie" || item.type === "episode") return formatRuntime(item.durationMinutes) || "—";
  return "—";
}

const LIST_ROW =
  "grid grid-cols-[minmax(0,1fr)_44px] md:grid-cols-[28px_minmax(0,3fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_70px_44px] gap-4 items-center";

export const WishlistView: React.FC<WishlistViewProps> = ({ onOpenItem, onExplore }) => {
  const { entries, remove, restore } = useWishlist();
  const { playTrack } = useAudio();
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<Sort>("recent");
  const [toast, setToast] = useState<WishlistEntry | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const count = (f: Filter) => entries.filter((e) => f === "all" || KIND[e.item.type] === f).length;
  const shown = entries
    .filter((e) => filter === "all" || KIND[e.item.type] === filter)
    .sort((a, b) =>
      sort === "title"
        ? a.item.title.localeCompare(b.item.title, "fr")
        : sort === "type"
        ? typeLabel(a.item.type).localeCompare(typeLabel(b.item.type), "fr") || b.savedAt - a.savedAt
        : b.savedAt - a.savedAt
    );
  const tracks = shown.filter((e) => e.item.type === "track").map((e) => e.item);

  const handleRemove = (id: string) => {
    const entry = remove(id);
    if (!entry) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(entry);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const handleUndo = () => {
    if (toast) restore(toast);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  };

  const playTracks = (shuffle: boolean) => {
    const queue = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
    if (queue.length > 0) playTrack(queue[0], queue);
  };

  const toggleBtn = (active: boolean) =>
    `press w-9 h-8 rounded-[9px] grid place-items-center ${
      active ? "bg-panel text-fg shadow-[0_1px_3px_rgba(0,0,0,.18)]" : "text-muted hover:text-fg"
    }`;

  return (
    <div className="relative">
      <CollectionHeader
        art={
          <div className="w-[120px] h-[120px] sm:w-[176px] sm:h-[176px] rounded-3xl bg-gradient-to-br from-[#f0323c] to-[#7a0a10] grid place-items-center flex-shrink-0 shadow-[0_30px_60px_-24px_rgba(229,19,29,.55)]">
            <Heart className="w-12 h-12 sm:w-[68px] sm:h-[68px] text-white fill-white" strokeWidth={0} />
          </div>
        }
        eyebrow="Collection privée"
        title="Ma liste"
        meta={
          <>
            <span>Sur cet appareil</span>
            <MetaDot />
            <span>
              {entries.length} {entries.length > 1 ? "éléments" : "élément"}
            </span>
          </>
        }
      />

      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-3">
        {tracks.length > 0 && (
          <>
            <BigPlayButton onClick={() => playTracks(false)} label="Lire les titres de ma liste" />
            <button
              type="button"
              onClick={() => playTracks(true)}
              aria-label="Lecture aléatoire"
              className="press w-11 h-11 rounded-full grid place-items-center text-muted hover:text-fg hover:bg-card"
            >
              <Shuffle className="w-5 h-5" strokeWidth={1.9} />
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            Trier
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-10 px-3 rounded-xl border border-line2 bg-panel text-fg text-sm outline-none"
            >
              <option value="recent">Ajout récent</option>
              <option value="title">Titre (A–Z)</option>
              <option value="type">Type</option>
            </select>
          </label>
          <div role="group" aria-label="Affichage" className="flex p-1 rounded-xl bg-card">
            <button type="button" onClick={() => setView("grid")} aria-label="Grille" aria-pressed={view === "grid"} className={toggleBtn(view === "grid")}>
              <LayoutGrid className="w-4 h-4" strokeWidth={2} />
            </button>
            <button type="button" onClick={() => setView("list")} aria-label="Liste" aria-pressed={view === "list"} className={toggleBtn(view === "list")}>
              <List className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <Pills
        label="Filtrer"
        size="sm"
        className="mt-[22px] mb-5 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: "Tout", count: count("all") },
          { id: "films", label: "Films", count: count("films") },
          { id: "series", label: "Séries", count: count("series") },
          { id: "music", label: "Albums", count: count("music") },
          { id: "tracks", label: "Titres", count: count("tracks") },
        ]}
      />

      {/* Grille */}
      {view === "grid" && shown.length > 0 && (
        <div key={filter} className="anim-in grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-[22px]">
          {shown.map(({ item }) => {
            const img = isAudio(item) ? item.thumb : item.art || item.thumb;
            return (
              <div key={item.id} className="lift relative">
                <button type="button" onClick={() => onOpenItem(item)} className="block w-full text-left">
                  <div className="zoom relative aspect-[16/10] rounded-[18px] bg-[#111]">
                    {isAudio(item) ? (
                      <>
                        <img
                          src={img || "/icon.svg"}
                          alt=""
                          loading="lazy"
                          className="z absolute -inset-5 w-[calc(100%+40px)] h-[calc(100%+40px)] max-w-none object-cover blur-[22px] saturate-[1.3] opacity-85"
                        />
                        <img
                          src={img || "/icon.svg"}
                          alt=""
                          loading="lazy"
                          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[70%] aspect-square object-cover shadow-[0_16px_34px_-12px_rgba(0,0,0,.6)] ${
                            item.type === "artist" ? "rounded-full" : "rounded-xl"
                          }`}
                        />
                      </>
                    ) : (
                      <img src={img || ""} alt="" loading="lazy" className="z w-full h-full object-cover" />
                    )}
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-xs font-medium">
                      {typeLabel(item.type)}
                    </span>
                  </div>
                  <div className="mt-3.5 pr-11 text-[15px] sm:text-base font-semibold truncate">{item.title}</div>
                  <div className="mt-0.5 pr-11 text-[13px] text-muted truncate">{itemMeta(item)}</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  aria-label={`Retirer ${item.title} de ma liste`}
                  className="press absolute right-0 bottom-0.5 w-10 h-10 rounded-full grid place-items-center text-accent hover:bg-card"
                >
                  <Heart className="w-5 h-5 fill-current" strokeWidth={0} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Liste */}
      {view === "list" && shown.length > 0 && (
        <div key={filter} className="anim-in">
          <div className={`${LIST_ROW} px-3 pb-2.5 border-b border-line text-[13px] text-muted`}>
            <span className="hidden md:block">#</span>
            <span>Titre</span>
            <span className="hidden md:block">Type</span>
            <span className="hidden md:block">Ajouté le</span>
            <span className="hidden md:block text-right">Durée</span>
            <span />
          </div>
          <div className="mt-2 flex flex-col gap-0.5">
            {shown.map(({ item, savedAt }, i) => (
              <div key={item.id} className={`${LIST_ROW} px-3 py-2 rounded-xl transition-colors hover:bg-card`}>
                <span className="hidden md:block text-sm text-muted tabular-nums">{i + 1}</span>
                <button type="button" onClick={() => onOpenItem(item)} className="flex items-center gap-3.5 min-w-0 text-left">
                  <img
                    src={(isAudio(item) ? item.thumb : item.art || item.thumb) || "/icon.svg"}
                    alt=""
                    loading="lazy"
                    className={`h-12 object-cover flex-shrink-0 bg-card ${
                      isAudio(item) ? "w-12" : "w-[78px]"
                    } ${item.type === "artist" ? "rounded-full" : "rounded-[9px]"}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold truncate">{item.title}</span>
                    <span className="block text-[13px] text-muted truncate">{itemMeta(item)}</span>
                  </span>
                </button>
                <span className="hidden md:block text-sm text-muted">{typeLabel(item.type)}</span>
                <span className="hidden md:block text-sm text-muted">{formatDate(savedAt)}</span>
                <span className="hidden md:block text-sm text-muted text-right tabular-nums">{itemDuration(item)}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  aria-label={`Retirer ${item.title} de ma liste`}
                  className="press w-10 h-10 rounded-full grid place-items-center text-accent hover:bg-surface3"
                >
                  <Heart className="w-[18px] h-[18px] fill-current" strokeWidth={0} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vide */}
      {shown.length === 0 && (
        <div className="anim-in py-16 px-5 text-center flex flex-col items-center">
          <div className="w-[88px] h-[88px] rounded-[28px] bg-card grid place-items-center">
            <Heart className="w-[38px] h-[38px] text-muted" strokeWidth={1.6} />
          </div>
          <h2 className="mt-[22px] text-2xl font-bold tracking-[-0.02em]">Rien ici pour l'instant</h2>
          <p className="mt-2 max-w-[380px] text-[15px] leading-relaxed text-muted">
            Touchez le cœur sur un film, une série ou un album pour le retrouver ici.
          </p>
          <button
            type="button"
            onClick={onExplore}
            className="press mt-[22px] h-12 px-6 rounded-full bg-accent hover:bg-accent-hover text-white font-semibold"
          >
            Explorer le catalogue
          </button>
        </div>
      )}

      {/* Toast d'annulation */}
      {toast && (
        <div
          role="status"
          className="toast fixed left-1/2 bottom-[180px] lg:bottom-28 z-50 flex items-center gap-4 pl-[18px] pr-2.5 py-2.5 rounded-2xl bg-[#1c1c21] text-white shadow-[0_20px_40px_-12px_rgba(0,0,0,.5)] text-sm max-w-[calc(100vw-24px)]"
        >
          <span className="truncate">« {toast.item.title} » retiré de votre liste</span>
          <button
            type="button"
            onClick={handleUndo}
            className="press h-9 px-3.5 rounded-[10px] bg-white/[.12] hover:bg-white/20 font-semibold flex-shrink-0"
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  );
};
