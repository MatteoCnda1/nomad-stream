import React, { createContext, useContext, useEffect, useState } from "react";
import { MediaItem, MediaDetail } from "../types";

// "Ma liste" : collection privée, stockée localement sur l'appareil
export interface WishlistEntry {
  item: MediaItem;
  savedAt: number;
}

interface WishlistContextType {
  entries: WishlistEntry[];
  isSaved: (id: string) => boolean;
  toggle: (item: MediaItem) => void;
  remove: (id: string) => WishlistEntry | undefined;
  restore: (entry: WishlistEntry) => void;
}

const STORAGE_KEY = "nomad-wishlist";
const WishlistContext = createContext<WishlistContextType | null>(null);

function readStored(): WishlistEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<WishlistEntry[]>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Stockage plein ou indisponible
    }
  }, [entries]);

  const isSaved = (id: string) => entries.some((e) => e.item.id === id);

  const toggle = (item: MediaItem) => {
    // On ne garde que les métadonnées : les URLs de flux sont redemandées à la lecture
    const { audioStreams, subtitleStreams, directStreamUrl, hlsStreamUrl, ...plain } = item as MediaDetail;
    setEntries((prev) =>
      prev.some((e) => e.item.id === item.id)
        ? prev.filter((e) => e.item.id !== item.id)
        : [{ item: plain, savedAt: Date.now() }, ...prev]
    );
  };

  const remove = (id: string) => {
    const entry = entries.find((e) => e.item.id === id);
    setEntries((prev) => prev.filter((e) => e.item.id !== id));
    return entry;
  };

  const restore = (entry: WishlistEntry) => {
    setEntries((prev) =>
      prev.some((e) => e.item.id === entry.item.id)
        ? prev
        : [...prev, entry].sort((a, b) => b.savedAt - a.savedAt)
    );
  };

  return (
    <WishlistContext.Provider value={{ entries, isSaved, toggle, remove, restore }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within a WishlistProvider");
  return ctx;
}
