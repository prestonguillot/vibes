/**
 * Playlist Details Service
 * Shared logic for fetching and processing playlist details with track/video matching
 * Used by both playlistDetails routes and sync operations to eliminate code duplication
 */

import SpotifyWebApi from 'spotify-web-api-node';
import { youtube_v3 } from 'googleapis';
import { optimalTrackMatching, ScoreBreakdown } from '../utils/trackMatching';
import { Logger } from '../utils/logger';

export interface SimplifiedTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArt?: string;
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
  matchScore?: ScoreBreakdown; // Match score for linked videos
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
  // Get Spotify playlist
  Logger.external('Spotify', 'Fetching playlist', { playlistId });
  const spotifyPlaylistData = await spotifyApi.getPlaylist(playlistId);

  // Fetch all tracks with pagination
  const allPlaylistItems: Array<unknown> = [];
  let offset = 0;
  const limit = 50;
  const totalTracks = spotifyPlaylistData.body.tracks.total;

  do {
    const response = await spotifyApi.getPlaylistTracks(playlistId, { limit, offset });
    if (response.body.items && response.body.items.length > 0) {
      allPlaylistItems.push(...response.body.items);
    }
    offset += limit;
  } while (allPlaylistItems.length < totalTracks);

  // Extract and filter Spotify tracks
  const spotifyTracks: SimplifiedTrack[] = allPlaylistItems
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
          album?: {
            name?: string;
            images?: Array<{ url?: string; height?: number; width?: number }>;
          };
          duration_ms: number;
          external_urls: { spotify: string };
          preview_url?: string | null;
        };
      };

      // Get the largest album art image (Spotify returns multiple sizes)
      const albumImages = typedItem.track.album?.images || [];
      const largestImage = albumImages.length > 0 ? albumImages[0].url : undefined;

      return {
        id: typedItem.track.id,
        name: typedItem.track.name,
        artist: typedItem.track.artists[0]?.name || 'Unknown Artist',
        album: typedItem.track.album?.name || 'Unknown Album',
        albumArt: largestImage,
        duration_ms: typedItem.track.duration_ms,
        external_urls: typedItem.track.external_urls,
        preview_url: typedItem.track.preview_url || null
      };
    });

  const totalTracksInPlaylist = spotifyPlaylistData.body.tracks.total;
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

    // First pass: Create video objects with basic info
    const videoIds = allPlaylistItems
      .map(item => item.snippet?.resourceId?.videoId)
      .filter(Boolean) as string[];

    // Fetch video statistics (view counts) if we have IDs
    const videoStats = new Map<string, number>();
    if (videoIds.length > 0) {
      try {
        // YouTube API allows 50 IDs per request
        for (let i = 0; i < videoIds.length; i += 50) {
          const batch = videoIds.slice(i, i + 50);
          const statsResponse = await youtube.videos.list({
            part: ['statistics'],
            id: batch
          }).then(res => res.data);

          if (statsResponse.items) {
            statsResponse.items.forEach((video: any) => {
              const viewCount = parseInt(video.statistics?.viewCount || '0', 10);
              videoStats.set(video.id || '', viewCount);
            });
          }
        }
        Logger.debug('Fetched video statistics for all playlist items', {
          videosWithStats: videoStats.size,
          totalVideos: videoIds.length
        });
      } catch (error: any) {
        Logger.warn('Error fetching video statistics, continuing without them', error);
      }
    }

    youtubeVideos = allPlaylistItems.map((item: youtube_v3.Schema$PlaylistItem): SimplifiedVideo => ({
      id: item.snippet?.resourceId?.videoId || '',
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      channelTitle: item.snippet?.channelTitle,
      viewCount: videoStats.get(item.snippet?.resourceId?.videoId || ''),
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
      publishedAt: item.snippet?.publishedAt,
      url: `https://www.youtube.com/watch?v=${item.snippet?.resourceId?.videoId || ''}`
    }));

    hasYoutubePlaylist = allPlaylistItems.length > 0;
    Logger.info('Found YouTube videos', { count: youtubeVideos.length });
  }

  // Match Spotify tracks to YouTube videos
  const matchingResult = optimalTrackMatching(spotifyTracks, youtubeVideos);
  const trackMatches = matchingResult.matches;
  const matchScores = matchingResult.scores;
  const linkedCount = trackMatches.size;

  // Build merged tracks (all Spotify tracks with optional YouTube matches)
  const mergedTracks: MergedTrack[] = spotifyTracks.map((track: SimplifiedTrack): MergedTrack => {
    const matchedVideo = trackMatches.get(track.id);
    const matchScore = matchedVideo ? matchScores.get(track.id) : undefined;
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
      linked: !!matchedVideo,
      matchScore
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
