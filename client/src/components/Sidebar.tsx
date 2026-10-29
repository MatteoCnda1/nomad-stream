import React from "react";
import { Home, Search, Clapperboard, Tv, Music, Heart, Download, Car, User, Plus } from "lucide-react";
import { useWishlist } from "../context/WishlistContext";
import { usePlaylist } from "../context/PlaylistContext";
import { useServerStatus } from "../hooks/useServerStatus";
import { MediaItem } from "../types";
import { typeLabel } from "../utils/format";
import { Logo } from "./ui";
import { PlaylistArt } from "./PlaylistArt";

interface SidebarProps {
  currentTab: string;
  setTab: (tab: string) => void;
  onOpenItem: (item: MediaItem) => void;
  onOpenPlaylist?: (playlistId: string) => void;
  hasPlayer: boolean;
}

const NAV = [
  { id: "home", label: "Accueil", icon: Home },
  { id: "search", label: "Rechercher", icon: Search },
  { id: "movies", label: "Films", icon: Clapperboard },
  { id: "shows", label: "Séries", icon: Tv },
  { id: "music", label: "Musique", icon: Music },
  { id: "wishlist", label: "Ma liste", icon: Heart },
  { id: "downloads", label: "Téléchargements", icon: Download },
  { id: "car", label: "Mode voiture", icon: Car },
  { id: "account", label: "Compte", icon: User },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, setTab, onOpenItem, onOpenPlaylist, hasPlayer }) => {
  const { entries } = useWishlist();
  const { playlists } = usePlaylist();
  const { serverName, isOnline } = useServerStatus();

  return (
    <aside
      className={`hidden lg:flex flex-col gap-2.5 w-[260px] xl:w-[290px] flex-shrink-0 sticky top-2.5 ${
        hasPlayer ? "h-[calc(100vh-116px)]" : "h-[calc(100vh-20px)]"
      }`}
    >
      <nav aria-label="Navigation" className="rounded-[22px] bg-surface px-3.5 pt-[22px] pb-3.5">
        <button type="button" onClick={() => setTab("home")} className="px-2.5 pb-[18px]" aria-label="Nomad, accueil">
          <Logo />
        </button>
        <div className="flex flex-col gap-0.5 text-[15px] font-medium">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = currentTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3.5 h-[46px] px-3.5 rounded-[14px] transition-colors ${
                  active ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-surface2 hover:text-fg"
                }`}
              >
                <Icon
                  className="w-[21px] h-[21px]"
                  strokeWidth={1.9}
                  fill={active && id === "wishlist" ? "currentColor" : "none"}
                />
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      <section aria-label="Ma bibliothèque" className="flex-1 min-h-0 flex flex-col rounded-[22px] bg-surface px-3 py-[18px]">
        <h2 className="px-2 pb-3.5 text-base font-semibold">Ma bibliothèque</h2>
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-0.5">
          <button type="button" onClick={() => setTab("wishlist")} className="tile flex items-center gap-3 p-2 rounded-[14px] text-left">
            <span className="w-12 h-12 rounded-[10px] bg-gradient-to-br from-[#e5131d] to-[#7a0a10] grid place-items-center flex-shrink-0">
              <Heart className="w-5 h-5 text-white fill-white" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">Ma liste</span>
              <span className="block text-[13px] text-muted">
                Collection · {entries.length} {entries.length > 1 ? "éléments" : "élément"}
              </span>
            </span>
          </button>

          {/* Playlists personnalisées */}
          {playlists.map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => onOpenPlaylist && onOpenPlaylist(pl.id)}
              className="tile flex items-center gap-3 p-2 rounded-[14px] text-left"
            >
              <PlaylistArt tracks={pl.tracks} className="w-12 h-12 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold truncate">{pl.title}</span>
                <span className="block text-[13px] text-muted truncate">
                  Playlist · {pl.tracks.length} {pl.tracks.length > 1 ? "titres" : "titre"}
                </span>
              </span>
            </button>
          ))}
          {entries.slice(0, 12).map(({ item }) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenItem(item)}
              className="tile flex items-center gap-3 p-2 rounded-[14px] text-left"
            >
              <img
                src={item.thumb || item.parentThumb || "/icon.svg"}
                alt=""
                loading="lazy"
                className={`w-12 h-12 object-cover flex-shrink-0 bg-surface2 ${
                  item.type === "artist" ? "rounded-full" : "rounded-[10px]"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold truncate">{item.title}</span>
                <span className="block text-[13px] text-muted truncate">
                  {typeLabel(item.type)}
                  {item.parentTitle && item.type !== "episode" ? ` · ${item.parentTitle}` : ""}
                </span>
              </span>
            </button>
          ))}
          {entries.length === 0 && (
            <p className="px-2 pt-2 text-[13px] leading-relaxed text-muted">
              Touchez le cœur sur un film, une série ou un album pour le retrouver ici.
            </p>
          )}
        </div>
        <div className="mt-3 px-2 flex items-center gap-2 text-xs text-muted">
          <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-ok" : "bg-accent"}`} />
          <span className="truncate">{serverName}</span>
          <span className="ml-auto">{isOnline ? "En ligne" : "Hors ligne"}</span>
        </div>
      </section>
    </aside>
  );
};
