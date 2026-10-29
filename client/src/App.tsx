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
import { PlaylistProvider, usePlaylist } from "./context/PlaylistContext";
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
import { Tab, useHistoryOverlay, useRouter } from "./router";

const DEFAULT_SORT = "titleSort:asc";

const TITLES: Record<Tab, string> = {
  home: "Accueil",
  movies: "Films",
  shows: "Séries",
  music: "Musique",
  wishlist: "Ma liste",
  account: "Compte",
  downloads: "Téléchargements",
  car: "Mode voiture",
  search: "Recherche",
};

const Shell: React.FC = () => {
  // L'écran affiché vient de l'adresse (voir router.ts)
  const { route, navigate, back } = useRouter();
  const tab = route.tab;
  const [online, setOnline] = useState(navigator.onLine);
  const [homeFilter, setHomeFilter] = useState<HomeFilter>("all");
  const [activeVideoMedia, setActiveVideoMedia] = useState<MediaDetail | null>(null);
  const [activeLocalSrc, setActiveLocalSrc] = useState<string | null>(null);
  const [launchingItem, setLaunchingItem] = useState<MediaItem | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const launchIdRef = useRef(0);
  // Artiste cliqué : son nom s'affiche avant la réponse du serveur
  const artistHintRef = useRef<MediaItem | null>(null);
  const { currentTrack, playTrack, isExpanded, setIsExpanded, isQueueOpen, setIsQueueOpen } = useAudio();
  const { modalTracks, closePlaylistModal } = usePlaylist();
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

  // Lancée sans réseau sur l'accueil, l'appli s'ouvre directement sur les téléchargements
  useEffect(() => {
    if (!navigator.onLine && route.tab === "home") navigate({ tab: "downloads" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = tab === "home" ? "Nomad Stream" : `${TITLES[tab]} · Nomad Stream`;
  }, [tab]);

  const closePlayer = () => {
    launchIdRef.current++;
    setLaunchingItem(null);
    setLaunchError(null);
    setActiveVideoMedia(null);
  };

  // Couches plein écran : « retour » les ferme, de la plus haute à la plus basse
  useHistoryOverlay("player", !!(launchingItem || activeVideoMedia), closePlayer);
  useHistoryOverlay("audio", isExpanded, () => setIsExpanded(false));
  useHistoryOverlay("queue", isQueueOpen, () => setIsQueueOpen(false));
  useHistoryOverlay("playlist-modal", !!modalTracks?.length, closePlaylistModal);

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

  const handleOpenMovie = (movieId: string) => navigate({ tab: "movies", movieId });
  const handleOpenShow = (showId: string) => navigate({ tab: "shows", showId });
  const handleOpenAlbum = (albumId: string) => navigate({ tab: "music", albumId });
  const handleOpenPlaylist = (playlistId: string) => navigate({ tab: "music", playlistId });
  const handleOpenArtist = (artist: MediaItem) => {
    artistHintRef.current = artist;
    navigate({ tab: "music", artistId: artist.id });
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

  const handleTabChange = (newTab: string) => navigate({ tab: newTab as Tab });

  // Chaque frappe remplace l'entrée de la recherche : « retour » ramène à l'écran d'avant
  const handleSearchChange = (q: string) => navigate({ tab: "search", q }, { replace: tab === "search" });

  const handleSortChange = (sortTab: "movies" | "shows") => (sort: string) =>
    navigate({ tab: sortTab, sort: sort === DEFAULT_SORT ? undefined : sort }, { replace: true, scroll: "top" });

  // Les fiches détaillées affichent leur propre en-tête plein écran sur mobile
  const isDetail = !!(route.movieId || route.showId || route.albumId || route.artistId || route.playlistId);
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
            searchQuery={route.q ?? ""}
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
              route.movieId ? (
                <MovieDetailView
                  key={route.movieId}
                  movieId={route.movieId}
                  onBack={() => back({ tab: "movies" })}
                  onPlayMedia={handlePlayMedia}
                />
              ) : (
                <MoviesView
                  onOpenMovie={handleOpenMovie}
                  sort={route.sort ?? DEFAULT_SORT}
                  onSortChange={handleSortChange("movies")}
                />
              )
            )}

            {tab === "shows" && (
              route.showId ? (
                <ShowDetailView
                  key={route.showId}
                  showId={route.showId}
                  onBack={() => back({ tab: "shows" })}
                  onPlayMedia={handlePlayMedia}
                />
              ) : (
                <ShowsView
                  onOpenShow={handleOpenShow}
                  sort={route.sort ?? DEFAULT_SORT}
                  onSortChange={handleSortChange("shows")}
                />
              )
            )}

            {tab === "music" && (
              route.playlistId ? (
                <PlaylistDetailView
                  key={route.playlistId}
                  playlistId={route.playlistId}
                  onBack={() => back({ tab: "music", playlists: true })}
                  onExploreMusic={() => navigate({ tab: "music" })}
                />
              ) : route.albumId ? (
                <AlbumDetailView
                  key={route.albumId}
                  albumId={route.albumId}
                  onBack={() => back({ tab: "music" })}
                />
              ) : (
                <MusicView
                  artistId={route.artistId}
                  artistHint={artistHintRef.current}
                  showPlaylists={!!route.playlists}
                  onSectionChange={(playlists) => navigate({ tab: "music", playlists }, { replace: true })}
                  onOpenArtist={handleOpenArtist}
                  onArtistBack={() => back({ tab: "music" })}
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
                query={route.q ?? ""}
                setQuery={(q) => navigate({ tab: "search", q }, { replace: true })}
                onClose={() => back({ tab: "home" })}
                onPlayMedia={handlePlayMedia}
                onOpenMovie={handleOpenMovie}
                onOpenShow={handleOpenShow}
                onOpenAlbum={handleOpenAlbum}
                onOpenArtist={handleOpenArtist}
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
          onClose={closePlayer}
        />
      )}
      {activeVideoMedia && (
        <VideoPlayer
          key={activeVideoMedia.id}
          media={activeVideoMedia}
          localSrc={activeLocalSrc}
          onClose={closePlayer}
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
