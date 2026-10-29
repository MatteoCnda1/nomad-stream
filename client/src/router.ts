// Routage par URL : l'adresse décrit l'écran (onglet, fiche, recherche, tri), ce qui donne le
// retour natif (geste, bouton), des liens partageables et le bon écran après un rechargement.
// Les couches plein écran (lecteurs, modales) ont leur propre entrée d'historique, sans changer
// l'adresse : « retour » les ferme avant de quitter la page.
import { useCallback, useEffect, useRef, useState } from "react";

export type Tab = "home" | "movies" | "shows" | "music" | "wishlist" | "account" | "downloads" | "car" | "search";

export interface Route {
  tab: Tab;
  movieId?: string;
  showId?: string;
  albumId?: string;
  artistId?: string;
  playlistId?: string;
  playlists?: boolean; // onglet « Playlists » de la musique
  sort?: string; // tri des listes Films / Séries (absent = tri par défaut)
  q?: string; // recherche
}

const TAB_PATHS: Record<Tab, string> = {
  home: "/",
  movies: "/films",
  shows: "/series",
  music: "/musique",
  wishlist: "/ma-liste",
  account: "/compte",
  downloads: "/telechargements",
  car: "/voiture",
  search: "/recherche",
};

const ID = /^[\w-]{1,64}$/;
const SORT = /^[\w.]{1,40}:(?:asc|desc)$/;

function decode(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

export function parseRoute(pathname: string, search = ""): Route {
  const params = new URLSearchParams(search);
  const [section = "", sub, arg] = pathname.split("/").filter(Boolean).map(decode);
  const id = (v?: string) => (v && ID.test(v) ? v : undefined);
  const tri = params.get("tri");
  const sort = tri && SORT.test(tri) ? tri : undefined;
  switch (section) {
    case "films":
      return sub ? { tab: "movies", movieId: id(sub) } : { tab: "movies", sort };
    case "series":
      return sub ? { tab: "shows", showId: id(sub) } : { tab: "shows", sort };
    case "musique":
      if (sub === "album") return { tab: "music", albumId: id(arg) };
      if (sub === "artiste") return { tab: "music", artistId: id(arg) };
      if (sub === "playlist") return { tab: "music", playlistId: id(arg) };
      return { tab: "music", playlists: sub === "playlists" };
    case "recherche":
      return { tab: "search", q: params.get("q") ?? "" };
    case "ma-liste":
      return { tab: "wishlist" };
    case "compte":
      return { tab: "account" };
    case "telechargements":
      return { tab: "downloads" };
    case "voiture":
      return { tab: "car" };
    default:
      return { tab: "home" }; // adresse inconnue : accueil
  }
}

function withQuery(path: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return qs ? `${path}?${qs}` : path;
}

export function routePath(r: Route): string {
  const e = encodeURIComponent;
  switch (r.tab) {
    case "movies":
      return r.movieId ? `/films/${e(r.movieId)}` : withQuery("/films", { tri: r.sort });
    case "shows":
      return r.showId ? `/series/${e(r.showId)}` : withQuery("/series", { tri: r.sort });
    case "music":
      if (r.albumId) return `/musique/album/${e(r.albumId)}`;
      if (r.artistId) return `/musique/artiste/${e(r.artistId)}`;
      if (r.playlistId) return `/musique/playlist/${e(r.playlistId)}`;
      return r.playlists ? "/musique/playlists" : "/musique";
    case "search":
      return withQuery("/recherche", { q: r.q || undefined });
    default:
      return TAB_PATHS[r.tab];
  }
}

// --- Historique ---

// Ce que l'appli range dans history.state : rang dans la pile de l'appli, position de défilement
// de la page, et couche plein écran éventuellement ouverte par cette entrée
type NavState = { idx: number; scrollY?: number; overlay?: string };

function navState(): NavState | null {
  const s = window.history.state;
  return s && typeof s === "object" && typeof s.idx === "number" ? s : null;
}

const currentPath = () => window.location.pathname + window.location.search;

// Couches actuellement ouvertes : une entrée d'historique dont la couche a déjà été fermée
// (deux couches fermées d'un coup, ex. lecteur audio replié avec sa file d'attente) est sautée
const openOverlays = new Set<string>();

// Mémorise la position de défilement de l'entrée courante (avant de la quitter)
function saveScroll() {
  const st = navState();
  if (st) window.history.replaceState({ ...st, scrollY: Math.round(window.scrollY) }, "");
}

// Les listes se remplissent juste après l'affichage (cache API) : on attend que la page soit
// assez haute pour atteindre la position, sans dépasser 1,5 s
function restoreScroll(y: number) {
  if (y <= 0) return window.scrollTo(0, 0);
  const t0 = performance.now();
  const step = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max >= y || performance.now() - t0 > 1500) window.scrollTo(0, Math.min(y, Math.max(0, max)));
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

type Scroll = number | "keep";

export function useRouter() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, window.location.search));
  const routeRef = useRef(route);
  const scrollRef = useRef<Scroll>(0);

  useEffect(() => {
    window.history.scrollRestoration = "manual";
    // Adresse normalisée (inconnue → accueil) ; une couche ouverte avant un rechargement est oubliée
    const st = navState();
    window.history.replaceState({ idx: st?.idx ?? 0, scrollY: st?.scrollY }, "", routePath(routeRef.current));
    scrollRef.current = st?.scrollY ?? 0;

    const onPop = () => {
      const st = navState();
      if (st?.overlay && !openOverlays.has(st.overlay)) window.history.back();
      const next = parseRoute(window.location.pathname, window.location.search);
      if (routePath(next) === routePath(routeRef.current)) return; // seule une couche a changé
      scrollRef.current = st?.scrollY ?? 0;
      routeRef.current = next;
      setRoute(next);
    };
    // Appli mise en arrière-plan ou fermée : la position est retrouvée au retour
    const onHide = () => document.visibilityState === "hidden" && saveScroll();
    window.addEventListener("popstate", onPop);
    window.addEventListener("pagehide", saveScroll);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pagehide", saveScroll);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => {
    const target = scrollRef.current;
    scrollRef.current = "keep";
    if (target !== "keep") restoreScroll(target);
  }, [route]);

  // replace : remplace l'entrée courante (frappe dans la recherche, tri) au lieu d'en empiler une
  const navigate = useCallback((next: Route, opts: { replace?: boolean; scroll?: "top" | "keep" } = {}) => {
    const { replace = false } = opts;
    const path = routePath(next);
    const st = navState() ?? { idx: 0 };
    if (path === currentPath() && !st.overlay) return;
    if (replace) {
      window.history.replaceState({ idx: st.idx }, "", path);
    } else {
      saveScroll();
      window.history.pushState({ idx: st.idx + 1 }, "", path);
    }
    scrollRef.current = (opts.scroll ?? (replace ? "keep" : "top")) === "top" ? 0 : "keep";
    routeRef.current = next;
    setRoute(next);
  }, []);

  // Retour « dans l'appli » : l'entrée précédente si elle existe (navigation interne), sinon
  // l'écran parent (arrivée directe par un lien partagé)
  const back = useCallback(
    (fallback: Route) => {
      if ((navState()?.idx ?? 0) > 0) window.history.back();
      else navigate(fallback, { replace: true, scroll: "top" });
    },
    [navigate]
  );

  return { route, navigate, back };
}

// Couche plein écran liée à l'historique : son ouverture empile une entrée (même adresse), et
// « retour » la ferme. La fermer depuis l'interface retire l'entrée correspondante.
export function useHistoryOverlay(name: string, open: boolean, close: () => void) {
  const openRef = useRef(open);
  const closeRef = useRef(close);
  openRef.current = open;
  closeRef.current = close;

  useEffect(() => {
    const st = navState() ?? { idx: 0 };
    if (open) openOverlays.add(name);
    else openOverlays.delete(name);
    if (open && st.overlay !== name) {
      saveScroll();
      window.history.pushState({ idx: st.idx + 1, overlay: name }, "");
    } else if (!open && st.overlay === name) {
      window.history.back();
    }
  }, [open, name]);

  useEffect(() => () => void openOverlays.delete(name), [name]);

  useEffect(() => {
    const onPop = () => {
      if (openRef.current && navState()?.overlay !== name) closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [name]);
}
