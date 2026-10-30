import React, { useEffect, useState } from "react";
import { ArtistDetail, MediaItem, MusicGenre } from "../types";
import { fetchMusicArtists, fetchArtistDetail, searchArtists, fetchMusicGenres } from "../api";
import { Heart, Plus, ListMusic, X, Search, RefreshCw } from "lucide-react";
import { useWishlist } from "../context/WishlistContext";
import { usePlaylist } from "../context/PlaylistContext";
import { useAudio } from "../context/AudioContext";
import { MusicTile, Sk, Pills, PlayGlyph } from "../components/ui";
import { LibraryHeader, LoadMore, TILE_GRID } from "../components/LibraryHeader";
import { usePagedList } from "../hooks/usePagedList";
import { CollectionArt, CollectionHeader } from "../components/Collection";
import { PlaylistArt } from "../components/PlaylistArt";
import { GenreTile, usePlayGenre } from "../components/GenreMixes";
import { MusicSection } from "../router";

// Artiste affiché et onglet Artistes / Genres / Playlists viennent de l'adresse
// (/musique/artiste/:id, /musique/genres, /musique/playlists) : le retour et le rechargement
// retrouvent le bon écran
interface MusicViewProps {
  artistId?: string;
  artistHint?: MediaItem | null; // l'artiste cliqué : son nom s'affiche sans attendre le serveur
  section?: MusicSection; // absent : Artistes
  onSectionChange: (section?: MusicSection) => void;
  onOpenArtist: (artist: MediaItem) => void;
  onArtistBack: () => void;
  onOpenAlbum: (albumId: string) => void;
  onOpenPlaylist?: (playlistId: string) => void;
  onOpenGenre: (genreId: string) => void;
}

// Recherche d'artiste en cours, gardée en quittant l'onglet (fiche artiste, album, retour)
let lastArtistQuery = "";

const TileGridSkeleton: React.FC<{ round?: boolean }> = ({ round }) => (
  <div className={TILE_GRID} aria-busy="true" aria-label="Chargement">
    {Array.from({ length: 12 }, (_, i) => (
      <div key={i} className="p-2.5">
        <Sk className={`aspect-square ${round ? "rounded-full" : "rounded-[14px]"}`} />
        <Sk className="mt-3 h-3.5 w-3/4 rounded-md" />
      </div>
    ))}
  </div>
);

export const MusicView: React.FC<MusicViewProps> = ({
  artistId,
  artistHint = null,
  section,
  onSectionChange,
  onOpenArtist,
  onArtistBack,
  onOpenAlbum,
  onOpenPlaylist,
  onOpenGenre,
}) => {
  const activeTab = section ?? "artists";
  const artistList = usePagedList("artists", fetchMusicArtists);
  const { items: artists, totalSize, loading } = artistList;

  // Genres (#50) : chargés à la première ouverture de l'onglet
  const [genres, setGenres] = useState<MusicGenre[] | null>(null);
  const [genresError, setGenresError] = useState(false);
  const [genresTry, setGenresTry] = useState(0);
  const playGenre = usePlayGenre();
  useEffect(() => {
    if (activeTab !== "genres" || genres) return;
    let active = true;
    setGenresError(false);
    fetchMusicGenres()
      .then((list) => active && setGenres(list))
      .catch((e) => {
        console.error(e);
        if (active) setGenresError(true);
      });
    return () => {
      active = false;
    };
  }, [activeTab, genres, genresTry]);

  // Barre de recherche réservée aux artistes : recherche approximative côté serveur (toute la
  // bibliothèque, pas seulement les artistes déjà affichés)
  const [artistQuery, setArtistQueryState] = useState(lastArtistQuery);
  const [foundArtists, setFoundArtists] = useState<MediaItem[] | null>(null);
  const [searchingArtists, setSearchingArtists] = useState(false);
  const setArtistQuery = (q: string) => {
    lastArtistQuery = q;
    setArtistQueryState(q);
  };
  const filtering = artistQuery.trim().length > 0;

  useEffect(() => {
    const q = artistQuery.trim();
    if (!q) {
      setFoundArtists(null);
      return;
    }
    let active = true;
    setSearchingArtists(true);
    const timer = window.setTimeout(() => {
      searchArtists(q)
        .then((list) => active && setFoundArtists(list))
        .catch((e) => console.error(e))
        .finally(() => active && setSearchingArtists(false));
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [artistQuery]);
  const { isSaved, toggle } = useWishlist();
  const { playlists, createPlaylist } = usePlaylist();
  const { playTrack } = useAudio();

  // Création rapide d'une playlist
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [newPlaylistDesc, setNewPlaylistDesc] = useState("");

  // Vue Artiste détaillée (route /musique/artiste/:id)
  const [artistDetail, setArtistDetail] = useState<ArtistDetail | null>(null);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const detail = artistDetail?.artist?.id === artistId ? artistDetail : null;
  const selectedArtist = detail?.artist ?? (artistHint?.id === artistId ? artistHint : null);
  const artistAlbums = detail?.albums ?? [];

  useEffect(() => {
    if (!artistId) return;
    let active = true;
    setLoadingAlbums(true);
    fetchArtistDetail(artistId)
      .then((res) => active && setArtistDetail(res))
      .catch((e) => console.error(e))
      .finally(() => active && setLoadingAlbums(false));
    return () => {
      active = false;
    };
  }, [artistId]);

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistTitle.trim()) return;
    const pl = createPlaylist(newPlaylistTitle.trim(), newPlaylistDesc.trim());
    setIsCreatingPlaylist(false);
    setNewPlaylistTitle("");
    setNewPlaylistDesc("");
    if (onOpenPlaylist) {
      onOpenPlaylist(pl.id);
    }
  };

  const handlePlayEntirePlaylist = (e: React.MouseEvent, pl: (typeof playlists)[0]) => {
    e.stopPropagation();
    if (pl.tracks.length > 0) {
      playTrack(pl.tracks[0], pl.tracks, 0);
    }
  };

  // Si un artiste est sélectionné (son nom peut arriver après l'affichage en arrivée directe)
  if (artistId) {
    const saved = selectedArtist ? isSaved(selectedArtist.id) : false;
    return (
      <div className="anim-in">
        <CollectionHeader
          onBack={onArtistBack}
          backLabel="Tous les artistes"
          art={<CollectionArt src={selectedArtist?.thumb ?? null} round />}
          eyebrow="Artiste"
          title={selectedArtist?.title ?? "…"}
          meta={
            <span>
              {loadingAlbums || !detail
                ? "…"
                : `${artistAlbums.length} ${artistAlbums.length > 1 ? "albums" : "album"}`}
            </span>
          }
        />

        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className="text-xl lg:text-[22px] font-bold tracking-[-0.02em]">Discographie</h2>
          <button
            type="button"
            onClick={() => selectedArtist && toggle(selectedArtist)}
            disabled={!selectedArtist}
            aria-pressed={saved}
            className={`press h-10 px-4 rounded-full border border-line2 hover:bg-card inline-flex items-center gap-2 text-sm font-medium disabled:opacity-50 ${
              saved ? "text-accent-text" : ""
            }`}
          >
            <Heart className={`w-4 h-4 ${saved ? "fill-current" : ""}`} strokeWidth={1.9} />
            {saved ? "Dans ma liste" : "Ma liste"}
          </button>
        </div>
        {loadingAlbums || !detail ? (
          <TileGridSkeleton />
        ) : (
          <div className={`${TILE_GRID} anim-in`}>
            {artistAlbums.map((album) => (
              <MusicTile
                key={album.id}
                img={album.thumb}
                title={album.title}
                sub={album.year ? `${album.year} · Album` : "Album"}
                onClick={() => onOpenAlbum(album.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <LibraryHeader
        title="Musique"
        subtitle={
          activeTab === "artists"
            ? filtering && foundArtists
              ? `${foundArtists.length} ${foundArtists.length > 1 ? "artistes trouvés" : "artiste trouvé"} sur ${totalSize}`
              : loading
                ? "Chargement…"
                : `${totalSize} artistes dans votre collection`
            : activeTab === "genres"
              ? "Des mixes tout faits, tirés au hasard dans chaque genre"
              : `${playlists.length} ${playlists.length > 1 ? "playlists créées" : "playlist créée"}`
        }
      />

      {/* Onglets Artistes / Genres / Playlists */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Pills
          label="Catégories musicales"
          options={[
            { id: "artists", label: "Artistes", count: totalSize || undefined },
            { id: "genres", label: "Genres", count: genres?.length || undefined },
            { id: "playlists", label: "Playlists", count: playlists.length },
          ]}
          value={activeTab}
          onChange={(tab) => onSectionChange(tab === "artists" ? undefined : tab)}
        />

        {activeTab === "playlists" && (
          <button
            type="button"
            onClick={() => setIsCreatingPlaylist(true)}
            className="press inline-flex items-center gap-2 h-10 px-4 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold shadow-md"
          >
            <Plus className="w-4 h-4" strokeWidth={2.2} />
            <span>Créer une playlist</span>
          </button>
        )}
      </div>

      {/* Modal Créer une playlist */}
      {isCreatingPlaylist && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-playlist-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 anim-in"
          onClick={() => setIsCreatingPlaylist(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-surface p-6 border border-line shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <h2 id="new-playlist-title" className="text-lg font-bold">Nouvelle playlist</h2>
              <button
                type="button"
                onClick={() => setIsCreatingPlaylist(false)}
                aria-label="Fermer"
                className="press w-8 h-8 rounded-full grid place-items-center text-muted hover:text-fg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreatePlaylist} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Nom de la playlist
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newPlaylistTitle}
                  onChange={(e) => setNewPlaylistTitle(e.target.value)}
                  placeholder="Ex : Soirée chill, Road trip, Top hits…"
                  className="w-full h-11 px-4 rounded-xl border border-line bg-card text-[15px] outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Description (optionnelle)
                </label>
                <textarea
                  rows={2}
                  value={newPlaylistDesc}
                  onChange={(e) => setNewPlaylistDesc(e.target.value)}
                  placeholder="De quoi s'agit-il ?"
                  className="w-full p-3 rounded-xl border border-line bg-card text-[14px] outline-none focus:border-accent resize-none"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingPlaylist(false)}
                  className="press px-4 h-10 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-surface2"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!newPlaylistTitle.trim()}
                  className="press px-5 h-10 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-40"
                >
                  Créer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contenu onglet ARTISTES */}
      {activeTab === "artists" && (
        <>
          <div role="search" className="relative mb-6 max-w-md">
            <label className="sr-only" htmlFor="artist-search">Rechercher un artiste</label>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted pointer-events-none" strokeWidth={2} />
            <input
              id="artist-search"
              type="search"
              value={artistQuery}
              onChange={(e) => setArtistQuery(e.target.value)}
              placeholder="Rechercher un artiste…"
              autoComplete="off"
              enterKeyHint="search"
              className="w-full h-12 pl-11 pr-11 rounded-full border border-line bg-surface text-[15px] placeholder:text-faint outline-none focus:border-line2"
            />
            {artistQuery && (
              <button
                type="button"
                onClick={() => setArtistQuery("")}
                aria-label="Effacer la recherche d'artiste"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center text-muted hover:text-fg"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {filtering ? (
            !foundArtists ? (
              <TileGridSkeleton round />
            ) : foundArtists.length === 0 ? (
              <div role="status" className="py-16 text-center text-muted">
                Aucun artiste pour « {artistQuery.trim()} »
              </div>
            ) : (
              <div className={`${TILE_GRID} anim-in transition-opacity ${searchingArtists ? "opacity-60" : ""}`}>
                {foundArtists.map((artist) => (
                  <MusicTile
                    key={artist.id}
                    img={artist.thumb}
                    title={artist.title}
                    sub="Artiste"
                    round
                    onClick={() => onOpenArtist(artist)}
                  />
                ))}
              </div>
            )
          ) : (
            <>
              {loading ? (
                <TileGridSkeleton round />
              ) : (
                <div className={`${TILE_GRID} anim-in`}>
                  {artists.map((artist) => (
                    <MusicTile
                      key={artist.id}
                      img={artist.thumb}
                      title={artist.title}
                      sub="Artiste"
                      round
                      onClick={() => onOpenArtist(artist)}
                    />
                  ))}
                </div>
              )}
              <LoadMore {...artistList} onLoadMore={artistList.loadMore} shown={artists.length} total={totalSize} />
            </>
          )}
        </>
      )}

      {/* Contenu onglet GENRES */}
      {activeTab === "genres" &&
        (genresError ? (
          <div role="alert" className="py-16 text-center text-muted">
            <p>Les genres arrivent dans un instant : la bibliothèque est en cours d'indexation.</p>
            <button
              type="button"
              onClick={() => setGenresTry((n) => n + 1)}
              className="press mt-4 inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" />
              Réessayer
            </button>
          </div>
        ) : !genres ? (
          <TileGridSkeleton />
        ) : genres.length === 0 ? (
          <div role="status" className="py-16 text-center text-muted max-w-md mx-auto">
            Aucun genre trouvé : les genres viennent des dossiers de la bibliothèque musicale
            (« Rap FR », « Reggae »…).
          </div>
        ) : (
          <div className={`${TILE_GRID} anim-in`}>
            {genres.map((genre) => (
              <GenreTile key={genre.id} genre={genre} onOpen={(g) => onOpenGenre(g.id)} onPlay={playGenre} />
            ))}
          </div>
        ))}

      {/* Contenu onglet PLAYLISTS */}
      {activeTab === "playlists" && (
        <div className="anim-in">
          {playlists.length === 0 ? (
            <div className="py-16 text-center text-muted">
              <ListMusic className="w-14 h-14 mx-auto mb-3 opacity-40" strokeWidth={1.4} />
              <h2 className="text-lg font-bold text-fg">Aucune playlist pour l'instant</h2>
              <p className="mt-1 text-sm text-muted max-w-sm mx-auto">
                Créez vos playlists personnalisées et ajoutez-y vos morceaux favoris depuis les
                albums ou la recherche.
              </p>
              <button
                type="button"
                onClick={() => setIsCreatingPlaylist(true)}
                className="press mt-5 inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold shadow-md"
              >
                <Plus className="w-4 h-4" />
                Créer ma première playlist
              </button>
            </div>
          ) : (
            <div className={TILE_GRID}>
              {playlists.map((pl) => (
                // Bouton « Écouter » à côté de celui de la tuile (pas l'un dans l'autre : un
                // élément cliquable imbriqué est inaccessible au clavier)
                <div key={pl.id} className="tile relative rounded-2xl group">
                  <button
                    type="button"
                    onClick={() => onOpenPlaylist && onOpenPlaylist(pl.id)}
                    className="block w-full text-left p-2.5 rounded-2xl"
                  >
                    <PlaylistArt
                      tracks={pl.tracks}
                      className="w-full aspect-square"
                    />
                    <div className="mt-3 text-[15px] font-semibold truncate group-hover:text-accent-text transition-colors">
                      {pl.title}
                    </div>
                    <div className="mt-0.5 text-[13px] leading-snug text-muted line-clamp-2">
                      {pl.tracks.length} {pl.tracks.length > 1 ? "titres" : "titre"}
                      {pl.description ? ` · ${pl.description}` : ""}
                    </div>
                  </button>
                  {pl.tracks.length > 0 && (
                    // Calque de la taille de la pochette : le bouton se pose dans son coin
                    <div className="pointer-events-none absolute inset-x-2.5 top-2.5 aspect-square">
                      <button
                        type="button"
                        onClick={(e) => handlePlayEntirePlaylist(e, pl)}
                        aria-label={`Écouter la playlist ${pl.title}`}
                        className="fab fab-action pointer-events-auto absolute right-2.5 bottom-2.5 w-[46px] h-[46px] rounded-full bg-accent grid place-items-center shadow-[0_10px_24px_-6px_rgba(229,19,29,.6)] text-white hover:scale-105 transition-transform"
                      >
                        <PlayGlyph className="w-[18px] h-[18px] text-white ml-0.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
