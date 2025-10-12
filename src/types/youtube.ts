/**
 * YouTube API response types
 * Based on YouTube Data API v3 documentation
 */

/**
 * YouTube video object
 */
export interface YouTubeVideo {
  kind: 'youtube#video';
  id: string;
  snippet: YouTubeVideoSnippet;
}

/**
 * YouTube video snippet
 */
export interface YouTubeVideoSnippet {
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnails: YouTubeThumbnails;
}

/**
 * YouTube thumbnails object
 */
export interface YouTubeThumbnails {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
}

/**
 * YouTube thumbnail
 */
export interface YouTubeThumbnail {
  url: string;
  width: number;
  height: number;
}

/**
 * YouTube playlist object
 */
export interface YouTubePlaylist {
  kind: 'youtube#playlist';
  id: string;
  snippet?: YouTubePlaylistSnippet;
}

/**
 * YouTube playlist snippet
 */
export interface YouTubePlaylistSnippet {
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnails: YouTubeThumbnails;
}

/**
 * YouTube playlist item
 */
export interface YouTubePlaylistItem {
  kind: 'youtube#playlistItem';
  id: string;
  snippet: YouTubePlaylistItemSnippet;
  contentDetails: YouTubePlaylistItemContentDetails;
}

/**
 * YouTube playlist item snippet
 */
export interface YouTubePlaylistItemSnippet {
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnails: YouTubeThumbnails;
  position: number;
  resourceId: {
    kind: string;
    videoId: string;
  };
}

/**
 * YouTube playlist item content details
 */
export interface YouTubePlaylistItemContentDetails {
  videoId: string;
  videoPublishedAt?: string;
}

/**
 * YouTube search result
 */
export interface YouTubeSearchResult {
  kind: 'youtube#searchResult';
  id: {
    kind: string;
    videoId?: string;
    channelId?: string;
    playlistId?: string;
  };
  snippet: YouTubeVideoSnippet;
}

/**
 * YouTube API list response (generic)
 */
export interface YouTubeListResponse<T> {
  kind: string;
  etag: string;
  items: T[];
  pageInfo?: {
    totalResults: number;
    resultsPerPage: number;
  };
  nextPageToken?: string;
  prevPageToken?: string;
}

/**
 * Helper type for formatted YouTube video data used in our app
 */
export interface FormattedYouTubeVideo {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
}
