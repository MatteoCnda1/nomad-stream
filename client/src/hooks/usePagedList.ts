import { useCallback, useEffect, useRef, useState } from "react";
import { MediaItem } from "../types";

// Listes longues (films, séries, artistes) chargées par pages au fil du défilement (#19).
// Le nombre de pages chargées est mémorisé par liste (et survit à un rechargement) : au retour
// d'une fiche, la liste revient aussi longue qu'avant et la position de défilement est retrouvée.
export const PAGE_SIZE = 100;

type Page = { items: MediaItem[]; totalSize: number };

const storageKey = (key: string) => `nomad-pages:${key}`;

function rememberedPages(key: string): number {
  try {
    return Math.min(20, Math.max(1, Number(sessionStorage.getItem(storageKey(key))) || 1));
  } catch {
    return 1;
  }
}

function rememberPages(key: string, pages: number) {
  try {
    sessionStorage.setItem(storageKey(key), String(pages));
  } catch {
    // Stockage indisponible : la liste repartira d'une page
  }
}

export function usePagedList(key: string, fetchPage: (offset: number, limit: number) => Promise<Page>) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const pagesRef = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  // Première ouverture (ou changement de tri) : autant de pages que la dernière fois, en parallèle
  useEffect(() => {
    let active = true;
    const pages = rememberedPages(key);
    setLoading(true);
    setFailed(false);
    Promise.all(Array.from({ length: pages }, (_, i) => fetchRef.current(i * PAGE_SIZE, PAGE_SIZE)))
      .then((results) => {
        if (!active) return;
        setItems(results.flatMap((r) => r.items));
        setTotalSize(results[0]?.totalSize ?? 0);
        pagesRef.current = pages;
      })
      .catch((err) => {
        console.error(err);
        if (active) setFailed(true);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [key]);

  const hasMore = !loading && items.length < totalSize;

  const loadMore = useCallback(() => {
    if (loading || loadingMore || items.length >= totalSize) return;
    const page = pagesRef.current;
    setLoadingMore(true);
    setFailed(false);
    fetchRef.current(page * PAGE_SIZE, PAGE_SIZE)
      .then((res) => {
        if (pagesRef.current !== page) return; // liste rechargée entre-temps
        // Sans doublon : la bibliothèque a pu changer entre deux pages
        setItems((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...prev, ...res.items.filter((m) => !ids.has(m.id))];
        });
        setTotalSize(res.totalSize);
        pagesRef.current = page + 1;
        rememberPages(key, page + 1);
      })
      .catch((err) => {
        console.error(err);
        setFailed(true);
      })
      .finally(() => setLoadingMore(false));
  }, [key, loading, loadingMore, items.length, totalSize]);

  // Repère en bas de liste : la page suivante est demandée un peu avant d'y arriver
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    nodeRef.current = node;
    if (!node || typeof IntersectionObserver === "undefined") return;
    observerRef.current = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadMoreRef.current(),
      { rootMargin: "0px 0px 1200px 0px" },
    );
    observerRef.current.observe(node);
  }, []);

  // Page arrivée alors que le repère est toujours en vue (grand écran) : l'observer ne signale
  // que les changements, on le réarme pour qu'il réévalue la position
  useEffect(() => {
    const observer = observerRef.current;
    const node = nodeRef.current;
    if (loading || loadingMore || !hasMore || !observer || !node) return;
    observer.unobserve(node);
    observer.observe(node);
  }, [loading, loadingMore, hasMore]);

  return { items, totalSize, loading, loadingMore, hasMore, failed, loadMore, sentinelRef };
}
