export interface MediaItem {
  id: string;
  key: string;
  type: "movie" | "episode" | "track" | "show" | "album" | "artist";
  title: string;
  originalTitle?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  summary: string;
  year?: number;
  duration: number;
  durationMinutes: number;
  viewOffset: number;
  progressPercent: number;
  rating?: number | null;
  contentRating?: string;
  studio?: string;
  tagline?: string;
  addedAt: number;
  thumb: string | null;
  art: string | null;
  parentThumb: string | null;
  grandparentThumb: string | null;
  genres: string[];
  directors: string[];
  roles: string[];
  partKey: string | null;
  partId?: string | null;
  bitrate?: number | null; // kb/s
  container?: string | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  videoResolution?: string | null;
  streamUrl?: string;
  trackNumber?: number;
  score?: number; // pertinence dans une recherche (0 à 1)
  autoplay?: boolean; // ajouté à la file par la lecture continue
  unavailable?: boolean; // playlist, « Ma liste » : introuvable dans la bibliothèque (#67)
}

export interface StreamTrack {
  id: number;
  index: number;
  language: string;
  languageCode: string;
  title: string;
  codec?: string;
  channels?: number;
  selected: boolean;
  forced?: boolean;
}

export interface MediaDetail extends MediaItem {
  audioStreams: StreamTrack[];
  subtitleStreams: StreamTrack[];
  directStreamUrl: string;
  hlsStreamUrl: string;
  // Fichier absent du disque du serveur (fiche Plex encore présente) : ni lecture ni téléchargement
  missing?: boolean;
  // Version lue (index Plex) quand la fiche en compte plusieurs, dont certaines disparues
  mediaIndex?: number;
  // Début du générique de fin (ms), quand Plex l'a détecté (Plex Pass) : l'épisode suivant est
  // proposé à ce moment-là plutôt qu'à la toute fin
  creditsStart?: number | null;
}

export interface Season {
  id: string;
  key: string;
  title: string;
  seasonNumber: number;
  episodeCount: number;
  thumb: string | null;
}

export interface ShowDetail {
  show: MediaItem;
  seasons: Season[];
  episodes: MediaItem[];
}

export interface ArtistDetail {
  artist: MediaItem;
  albums: MediaItem[];
}

export interface AlbumDetail {
  album: MediaItem;
  tracks: MediaItem[];
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  tracks: MediaItem[];
  coverArt?: string | null;
}

// Genre de la musique (#50) : un dossier de genre de la bibliothèque (« Rap FR », « Reggae »…)
export interface MusicGenre {
  id: string;
  name: string;
  trackCount: number;
  artistCount: number;
  covers: string[]; // pochettes des albums phares du genre, pour la mosaïque
}

// Mix tout fait : titres du genre tirés au hasard par la passerelle
export interface GenreMix {
  genre: MusicGenre;
  items: MediaItem[];
}

export interface HubData {
  onDeck: MediaItem[];
  recentMovies: MediaItem[];
  recentShows: MediaItem[];
  recentMusic: MediaItem[];
}

export interface SearchResults {
  top: MediaItem | null; // meilleur résultat, tous types confondus
  movies: MediaItem[];
  shows: MediaItem[];
  artists: MediaItem[];
  albums: MediaItem[];
  tracks: MediaItem[];
}
