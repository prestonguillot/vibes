/**
 * Spotify API response types
 * Based on Spotify Web API documentation
 */

/**
 * Spotify track object
 */
export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  duration_ms: number;
  external_urls: {
    spotify: string;
  };
  preview_url: string | null;
  type: 'track';
}

/**
 * Spotify artist object
 */
export interface SpotifyArtist {
  id: string;
  name: string;
  external_urls: {
    spotify: string;
  };
}

/**
 * Spotify album object
 */
export interface SpotifyAlbum {
  id: string;
  name: string;
  images: SpotifyImage[];
  external_urls: {
    spotify: string;
  };
}

/**
 * Spotify image object
 */
export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

/**
 * Spotify playlist object
 */
export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  owner: SpotifyUser;
  tracks: {
    total: number;
  };
  external_urls: {
    spotify: string;
  };
  images: SpotifyImage[];
}

/**
 * Spotify user object
 */
export interface SpotifyUser {
  id: string;
  display_name: string | null;
  external_urls: {
    spotify: string;
  };
}

/**
 * Spotify playlist track item
 * Note: track can be null for deleted/unavailable tracks
 */
export interface SpotifyPlaylistTrackItem {
  track: SpotifyTrack | null;
  added_at: string;
  added_by: SpotifyUser;
}

/**
 * Spotify paged response
 */
export interface SpotifyPagingObject<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
  previous: string | null;
}

/**
 * Helper type for formatted track data used in our app
 */
export interface FormattedSpotifyTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  spotifyUrl: string;
}
