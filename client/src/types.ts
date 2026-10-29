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

export interface HubData {
  onDeck: MediaItem[];
  recentMovies: MediaItem[];
  recentShows: MediaItem[];
  recentMusic: MediaItem[];
}

export interface SearchResults {
  movies: MediaItem[];
  shows: MediaItem[];
  tracks: MediaItem[];
  artists: MediaItem[];
}
