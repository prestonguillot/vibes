/**
 * Playlist Details Service
 * Shared logic for fetching and processing playlist details with track/video matching
 * Used by both playlistDetails routes and sync operations to eliminate code duplication
 */

import SpotifyWebApi from 'spotify-web-api-node';
import { youtube_v3 } from 'googleapis';
import { optimalTrackMatching } from '../utils/trackMatching';
import { Logger } from '../utils/logger';

export interface SimplifiedTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration_ms?: number;
  external_urls?: { spotify: string };
  preview_url?: string | null;
}

export interface SimplifiedVideo {
  id: string;
  title: string;
  description: string;
  thumbnail?: string;
  publishedAt?: string;
  url?: string;
  channelTitle?: string;
}

export interface MergedTrack {
  spotify: SimplifiedTrack | null;
  youtube: SimplifiedVideo | null;
  linked: boolean;
}

export interface PlaylistDetails {
  playlistId: string;
  playlistName: string;
  tracks: MergedTrack[];
  linkedCount: number;
  totalTracks: number;
  hasYoutubePlaylist: boolean;
}

/**
 * Fetch and process complete playlist details with track/video matching
 * @param spotifyApi - Authenticated Spotify API instance
 * @param youtube - Authenticated YouTube API instance (optional)
 * @param playlistId - Spotify playlist ID
 * @param youtubePlaylistId - YouTube playlist ID (optional, for matching)
 * @returns Complete playlist details with all tracks and matches
 */
export async function fetchPlaylistDetails(
  spotifyApi: SpotifyWebApi,
  youtube: youtube_v3.Youtube | null,
  playlistId: string,
  youtubePlaylistId?: string
): Promise<PlaylistDetails> {
  // Get Spotify playlist and tracks
  Logger.external('Spotify', 'Fetching playlist', { playlistId });
  const spotifyPlaylistData = await spotifyApi.getPlaylist(playlistId);

  // Extract and filter Spotify tracks
  const spotifyTracks: SimplifiedTrack[] = spotifyPlaylistData.body.tracks.items
    .filter((item: unknown) => {
      const typedItem = item as { track: unknown | null };
      return typedItem.track !== null;
    })
    .map((item: unknown): SimplifiedTrack => {
      const typedItem = item as {
        track: {
          id: string;
          name: string;
          artists: Array<{ name?: string }>;
          album?: { name?: string };
          duration_ms: number;
          external_urls: { spotify: string };
          preview_url?: string | null;
        };
      };
      return {
        id: typedItem.track.id,
        name: typedItem.track.name,
        artist: typedItem.track.artists[0]?.name || 'Unknown Artist',
        album: typedItem.track.album?.name || 'Unknown Album',
        duration_ms: typedItem.track.duration_ms,
        external_urls: typedItem.track.external_urls,
        preview_url: typedItem.track.preview_url || null
      };
    });

  const totalTracksInPlaylist = spotifyPlaylistData.body.tracks.items.length;
  const nullTracksCount = totalTracksInPlaylist - spotifyTracks.length;

  if (nullTracksCount > 0) {
    Logger.warn('Playlist contains unavailable tracks', {
      playlistId,
      totalTracks: totalTracksInPlaylist,
      availableTracks: spotifyTracks.length,
      unavailableTracks: nullTracksCount
    });
  }

  Logger.info('Found Spotify tracks', { count: spotifyTracks.length });

  // Get YouTube videos if playlist exists and YouTube is connected
  let youtubeVideos: SimplifiedVideo[] = [];
  let hasYoutubePlaylist = false;

  if (youtube && youtubePlaylistId) {
    Logger.external('YouTube', 'Fetching playlist videos', { youtubePlaylistId });

    const allPlaylistItems: youtube_v3.Schema$PlaylistItem[] = [];
    let nextPageToken: string | undefined = undefined;

    do {
      const response: youtube_v3.Schema$PlaylistItemListResponse = await youtube.playlistItems
        .list({
          part: ['id', 'snippet'],
          playlistId: youtubePlaylistId,
          maxResults: 50,
          pageToken: nextPageToken
        })
        .then(res => res.data);

      if (response.items) {
        allPlaylistItems.push(...response.items);
      }

      nextPageToken = response.nextPageToken || undefined;
    } while (nextPageToken);

    youtubeVideos = allPlaylistItems.map((item: youtube_v3.Schema$PlaylistItem): SimplifiedVideo => ({
      id: item.snippet?.resourceId?.videoId || '',
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
      publishedAt: item.snippet?.publishedAt,
      url: `https://www.youtube.com/watch?v=${item.snippet?.resourceId?.videoId || ''}`
    }));

    hasYoutubePlaylist = allPlaylistItems.length > 0;
    Logger.info('Found YouTube videos', { count: youtubeVideos.length });
  }

  // Match Spotify tracks to YouTube videos
  const trackMatches = optimalTrackMatching(spotifyTracks, youtubeVideos);
  const linkedCount = trackMatches.size;

  // Build merged tracks (all Spotify tracks with optional YouTube matches)
  const mergedTracks: MergedTrack[] = spotifyTracks.map((track: SimplifiedTrack): MergedTrack => {
    const matchedVideo = trackMatches.get(track.id);
    return {
      spotify: track,
      youtube: matchedVideo
        ? {
            id: matchedVideo.id,
            title: matchedVideo.title,
            description: matchedVideo.description,
            thumbnail: `https://img.youtube.com/vi/${matchedVideo.id}/default.jpg`,
            url: `https://www.youtube.com/watch?v=${matchedVideo.id}`
          }
        : null,
      linked: !!matchedVideo
    };
  });

  // Add orphaned YouTube videos (not matched to any Spotify track)
  const matchedVideoIds = trackMatches.size > 0 ? Array.from(trackMatches.values()).map(v => v.id) : [];
  const orphanedVideos = youtubeVideos
    .filter(v => !matchedVideoIds.includes(v.id))
    .map((video: SimplifiedVideo): MergedTrack => ({
      spotify: null,
      youtube: {
        id: video.id,
        title: video.title,
        description: video.description,
        thumbnail: `https://img.youtube.com/vi/${video.id}/default.jpg`,
        url: `https://www.youtube.com/watch?v=${video.id}`
      },
      linked: false
    }));

  const allTracks = [...mergedTracks, ...orphanedVideos];

  Logger.info('Playlist details processed', {
    totalSpotifyTracks: spotifyTracks.length,
    totalYoutubeVideos: youtubeVideos.length,
    matchedTracks: linkedCount,
    orphanedYoutubeVideos: orphanedVideos.length,
    totalTracks: allTracks.length
  });

  return {
    playlistId,
    playlistName: spotifyPlaylistData.body.name,
    tracks: allTracks,
    linkedCount,
    totalTracks: spotifyTracks.length,
    hasYoutubePlaylist
  };
}
