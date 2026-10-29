import React, { useEffect, useRef, useState } from "react";
import { AudioProvider, useAudio } from "./context/AudioContext";
import { ThemeProvider } from "./context/ThemeContext";
import { WishlistProvider } from "./context/WishlistContext";
import { DownloadsProvider, useDownloads } from "./context/DownloadsContext";
import { Navbar } from "./components/Navbar";
import { Sidebar } from "./components/Sidebar";
import { BottomNav } from "./components/BottomNav";
import { AudioPlayer } from "./components/AudioPlayer";
import { VideoPlayer, PlayerLoadingScreen } from "./components/VideoPlayer";
import { HomeView, HomeFilter } from "./views/HomeView";
import { MoviesView } from "./views/MoviesView";
import { MovieDetailView } from "./views/MovieDetailView";
import { ShowsView } from "./views/ShowsView";
import { ShowDetailView } from "./views/ShowDetailView";
import { MusicView } from "./views/MusicView";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { PlaylistDetailView } from "./views/PlaylistDetailView";
import { PlaylistModal } from "./components/PlaylistModal";
import { GlobalToast } from "./components/GlobalToast";
import { PlaylistProvider } from "./context/PlaylistContext";
import { SearchView } from "./views/SearchView";
import { CarModeView } from "./views/CarModeView";
import { WishlistView } from "./views/WishlistView";
import { AccountView } from "./views/AccountView";
import { DownloadsView } from "./views/DownloadsView";
import { MediaItem, MediaDetail } from "./types";
import { fetchMetadata } from "./api";
import { offlineUrl } from "./offline";
import { WifiOff } from "lucide-react";
import { AuthGate } from "./components/AuthGate";

const Shell: React.FC = () => {
  // Lancée sans réseau, l'appli s'ouvre directement sur les téléchargements
  const [tab, setTab] = useState<string>(() => (navigator.onLine ? "home" : "downloads"));
  const [online, setOnline] = useState(navigator.onLine);
  const [homeFilter, setHomeFilter] = useState<HomeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMovieId, setActiveMovieId] = useState<string | null>(null);
  const [activeShowId, setActiveShowId] = useState<string | null>(null);
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [activeArtist, setActiveArtist] = useState<MediaItem | null>(null);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activeVideoMedia, setActiveVideoMedia] = useState<MediaDetail | null>(null);
  const [activeLocalSrc, setActiveLocalSrc] = useState<string | null>(null);
  const [launchingItem, setLaunchingItem] = useState<MediaItem | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const launchIdRef = useRef(0);
  // Navigation / bouton retour : profondeur d'historique déjà poussée, pops à ignorer,
  // et fermeture de la couche supérieure (recalculée à chaque rendu via une ref).
  const pushedDepthRef = useRef(0);
  const suppressPopRef = useRef(0);
  const closeTopRef = useRef<() => boolean>(() => false);
  const { currentTrack, playTrack } = useAudio();
  const downloads = useDownloads();

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // Remonter en haut de page à chaque changement de vue
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, activeMovieId, activeShowId, activeAlbumId, activeArtist, activePlaylistId]);

  // Synchronise la pile d'historique du navigateur avec la profondeur de navigation,
  // pour que le bouton/geste "retour" ferme la couche du dessus (lecteur, fiche, onglet)
  // plutôt que de quitter la PWA. Les fermetures via l'UI (onBack/onClose) réduisent la
  // profondeur : l'effet retire alors l'entrée d'historique correspondante.
  useEffect(() => {
    const hasPlayer = !!(launchingItem || activeVideoMedia);
    const detailOpen = !!(activeMovieId || activeShowId || activeAlbumId || activeArtist || activePlaylistId);
    const depth = (tab !== "home" ? 1 : 0) + (detailOpen ? 1 : 0) + (hasPlayer ? 1 : 0);
    const pushed = pushedDepthRef.current;
    if (depth > pushed) {
      for (let i = 0; i < depth - pushed; i++) window.history.pushState(null, "");
      pushedDepthRef.current = depth;
    } else if (depth < pushed) {
      const diff = pushed - depth;
      suppressPopRef.current += diff;
      pushedDepthRef.current = depth;
      window.history.go(-diff);
    }
  }, [tab, activeMovieId, activeShowId, activeAlbumId, activeArtist, activePlaylistId, launchingItem, activeVideoMedia]);

  // Écouteur unique : un "retour" réel ferme la couche du dessus ; les pops provoqués
  // par la synchro ci-dessus (fermeture UI) sont ignorés.
  useEffect(() => {
    const onPop = () => {
      if (suppressPopRef.current > 0) {
        suppressPopRef.current--;
        return;
      }
      const closed = closeTopRef.current();
      if (closed) pushedDepthRef.current = Math.max(0, pushedDepthRef.current - 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Helper pour lancer n'importe quel média vidéo
  const handlePlayMedia = async (item: MediaItem | MediaDetail) => {
    // Écran de lecture affiché tout de suite, pendant le chargement des métadonnées
    const launchId = ++launchIdRef.current;
    setLaunchingItem(item);
    setLaunchError(null);
    // Une version téléchargée est lue depuis l'appareil : aucune dépendance au réseau
    const local = downloads.entries.find((e) => e.media.id === item.id && e.state === "done" && e.serverKey);
    try {
      let detail: MediaDetail;
      if (local) {
        // Position de reprise à jour si le serveur répond vite, sinon celle du téléchargement
        detail = await Promise.race([
          fetchMetadata(item.id),
          new Promise<MediaDetail>((resolve) => setTimeout(() => resolve(local.media), 1500)),
        ]).catch(() => local.media);
      } else {
        // Toujours relire les métadonnées (instantané si en cache) : la position de reprise a pu changer
        detail = await fetchMetadata(item.id);
      }
      if (launchId !== launchIdRef.current) return;
      setActiveLocalSrc(local?.serverKey ? offlineUrl(local.serverKey) : null);
      setActiveVideoMedia(detail);
      setLaunchingItem(null);
    } catch (e) {
      console.error("Erreur de lancement média :", e);
      if (launchId === launchIdRef.current) {
        setLaunchError(online ? "Impossible de lancer la lecture." : "Hors connexion : seuls les téléchargements sont disponibles.");
      }
    }
  };

  const handleOpenMovie = (movieId: string) => {
    setActiveMovieId(movieId);
    setTab("movies");
  };

  const handleOpenShow = (showId: string) => {
    setActiveShowId(showId);
    setTab("shows");
  };

  const handleOpenAlbum = (albumId: string) => {
    setActivePlaylistId(null);
    setActiveAlbumId(albumId);
    setTab("music");
  };

  const handleOpenArtist = (artist: MediaItem) => {
    setActivePlaylistId(null);
    setActiveAlbumId(null);
    setActiveArtist(artist);
    setTab("music");
  };

  const handleOpenPlaylist = (playlistId: string) => {
    setActivePlaylistId(playlistId);
    setActiveAlbumId(null);
    setActiveArtist(null);
    setTab("music");
  };

  // Ouvre n'importe quel élément (Ma liste, bibliothèque) selon son type
  const handleOpenItem = (item: MediaItem) => {
    switch (item.type) {
      case "movie": return handleOpenMovie(item.id);
      case "show": return handleOpenShow(item.id);
      case "episode": return handlePlayMedia(item);
      case "album": return handleOpenAlbum(item.id);
      case "artist": return handleOpenArtist(item);
      case "track": return playTrack(item, [item]);
    }
  };

  const handleTabChange = (newTab: string) => {
    setTab(newTab);
    setActiveMovieId(null);
    setActiveShowId(null);
    setActiveAlbumId(null);
    setActiveArtist(null);
    setActivePlaylistId(null);
  };

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (q && tab !== "search") handleTabChange("search");
  };

  // Ferme la couche de navigation la plus haute ; renvoie false au niveau racine
  // (accueil) pour laisser le navigateur quitter l'app. Appelée sur "retour" réel.
  closeTopRef.current = () => {
    if (launchingItem || activeVideoMedia) {
      launchIdRef.current++;
      setLaunchingItem(null);
      setLaunchError(null);
      setActiveVideoMedia(null);
      return true;
    }
    if (activeMovieId || activeShowId || activeAlbumId || activeArtist || activePlaylistId) {
      setActiveMovieId(null);
      setActiveShowId(null);
      setActiveAlbumId(null);
      setActiveArtist(null);
      setActivePlaylistId(null);
      return true;
    }
    if (tab !== "home") {
      handleTabChange("home");
      return true;
    }
    return false;
  };

  // Les fiches détaillées affichent leur propre en-tête plein écran sur mobile
  const isDetail = !!(activeMovieId || activeShowId || activeAlbumId || activeArtist || activePlaylistId);
  const hideMobileHeader = isDetail || ["search", "car", "wishlist", "account", "downloads"].includes(tab);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-start gap-2.5 lg:p-2.5">
        <Sidebar
          currentTab={tab}
          setTab={handleTabChange}
          onOpenItem={handleOpenItem}
          onOpenPlaylist={handleOpenPlaylist}
          hasPlayer={!!currentTrack}
        />

        <main className="flex-1 min-w-0 min-h-screen lg:min-h-[calc(100vh-20px)] bg-panel lg:rounded-[22px] overflow-hidden">
          <Navbar
            currentTab={tab}
            setTab={handleTabChange}
            homeFilter={homeFilter}
            setHomeFilter={setHomeFilter}
            searchQuery={searchQuery}
            setSearchQuery={handleSearchChange}
            hideOnMobile={hideMobileHeader}
          />

          {!online && (
            <div role="status" className="mx-4 sm:mx-6 lg:mx-7 mb-4 mt-[max(12px,env(safe-area-inset-top))] lg:mt-0 flex items-center gap-3 px-4 py-3 rounded-2xl bg-card text-sm">
              <WifiOff className="w-5 h-5 text-accent-text flex-shrink-0" strokeWidth={1.8} />
              <span className="flex-1">Hors connexion : vos téléchargements restent disponibles.</span>
              {tab !== "downloads" && (
                <button type="button" onClick={() => handleTabChange("downloads")} className="font-semibold text-accent-text">
                  Voir
                </button>
              )}
            </div>
          )}

          <div className={`px-4 sm:px-6 lg:px-7 ${currentTrack ? "pb-[210px] lg:pb-10" : "pb-32 lg:pb-10"}`}>
            {tab === "home" && (
              <HomeView
                filter={homeFilter}
                onPlayMedia={handlePlayMedia}
                onOpenMovie={handleOpenMovie}
                onOpenShow={handleOpenShow}
                onOpenAlbum={handleOpenAlbum}
                onNavigate={handleTabChange}
              />
            )}

            {tab === "movies" && (
              activeMovieId ? (
                <MovieDetailView
                  movieId={activeMovieId}
                  onBack={() => setActiveMovieId(null)}
                  onPlayMedia={handlePlayMedia}
                />
              ) : (
                <MoviesView onOpenMovie={handleOpenMovie} />
              )
            )}

            {tab === "shows" && (
              activeShowId ? (
                <ShowDetailView
                  showId={activeShowId}
                  onBack={() => setActiveShowId(null)}
                  onPlayMedia={handlePlayMedia}
                />
              ) : (
                <ShowsView onOpenShow={handleOpenShow} />
              )
            )}

            {tab === "music" && (
              activePlaylistId ? (
                <PlaylistDetailView
                  playlistId={activePlaylistId}
                  onBack={() => setActivePlaylistId(null)}
                  onExploreMusic={() => {
                    setActivePlaylistId(null);
                    setActiveAlbumId(null);
                    setActiveArtist(null);
                  }}
                />
              ) : activeAlbumId ? (
                <AlbumDetailView
                  albumId={activeAlbumId}
                  onBack={() => setActiveAlbumId(null)}
                />
              ) : (
                <MusicView
                  key={activeArtist?.id || "artists"}
                  initialArtist={activeArtist}
                  onOpenAlbum={handleOpenAlbum}
                  onOpenPlaylist={handleOpenPlaylist}
                />
              )
            )}

            {tab === "wishlist" && (
              <WishlistView onOpenItem={handleOpenItem} onExplore={() => handleTabChange("home")} />
            )}

            {tab === "account" && <AccountView onNavigate={handleTabChange} />}

            {tab === "downloads" && (
              <DownloadsView onPlay={(entry) => handlePlayMedia(entry.media)} onExplore={() => handleTabChange("home")} />
            )}

            {tab === "car" && (
              <CarModeView onPlayMedia={handlePlayMedia} />
            )}

            {tab === "search" && (
              <SearchView
                query={searchQuery}
                setQuery={setSearchQuery}
                onClose={() => {
                  setSearchQuery("");
                  handleTabChange("home");
                }}
                onPlayMedia={handlePlayMedia}
                onOpenMovie={handleOpenMovie}
                onOpenShow={handleOpenShow}
                onOpenAlbum={handleOpenAlbum}
              />
            )}
          </div>
        </main>
      </div>

      {/* Lecteur audio : barre desktop, mini-lecteur mobile, plein écran */}
      <AudioPlayer />

      {/* Dock de navigation (mobile & tablette) */}
      <BottomNav currentTab={tab} setTab={handleTabChange} />

      {/* Fullscreen Video Player Modal */}
      {launchingItem && !activeVideoMedia && (
        <PlayerLoadingScreen
          item={launchingItem}
          status={launchError || "Chargement…"}
          onClose={() => {
            launchIdRef.current++;
            setLaunchingItem(null);
            setLaunchError(null);
          }}
        />
      )}
      {activeVideoMedia && (
        <VideoPlayer
          key={activeVideoMedia.id}
          media={activeVideoMedia}
          localSrc={activeLocalSrc}
          onClose={() => setActiveVideoMedia(null)}
        />
      )}

      {/* Modale d'ajout à une playlist */}
      <PlaylistModal />

      {/* Notifications toast globales */}
      <GlobalToast />
    </div>
  );
};

export const App: React.FC = () => (
  <ThemeProvider>
    <AuthGate>
      <WishlistProvider>
        <DownloadsProvider>
          <PlaylistProvider>
            <AudioProvider>
              <Shell />
            </AudioProvider>
          </PlaylistProvider>
        </DownloadsProvider>
      </WishlistProvider>
    </AuthGate>
  </ThemeProvider>
);

export default App;
