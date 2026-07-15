/**
 * Playlist Details Service
 * Shared logic for fetching and processing playlist details with track/video matching
 * Used by both playlistDetails routes and sync operations to eliminate code duplication
 */

import { YoutubeClient, YtPlaylistItem } from '../youtube/client';
import { fetchAllYoutubePlaylistItems } from '../youtube/playlist';
import { optimalTrackMatching, ScoreBreakdown } from '../sync/trackMatching';
import { fetchAllPlaylistItems } from '../spotify/playlistItems';
import { getPlaylist } from '../spotify/client';
import { Logger } from '../lib/logger';

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
  /** True when a sync would change the YouTube playlist (order drift, orphan
   *  videos, or unsynced tracks) - i.e. the two playlists are out of sync. */
  needsResync: boolean;
}

/**
 * Fetch and process complete playlist details with track/video matching
 * @param accessToken - Valid Spotify access token
 * @param youtube - Authenticated YouTube API instance (optional)
 * @param playlistId - Spotify playlist ID
 * @param youtubePlaylistId - YouTube playlist ID (optional, for matching)
 * @returns Complete playlist details with all tracks and matches
 */
export async function fetchPlaylistDetails(
  accessToken: string,
  youtube: YoutubeClient | null,
  playlistId: string,
  youtubePlaylistId?: string,
): Promise<PlaylistDetails> {
  // Get Spotify playlist metadata and all of its items (the /items endpoint;
  // /tracks was removed in Feb 2026).
  Logger.external('Spotify', 'Fetching playlist', { playlistId });
  const spotifyPlaylist = await getPlaylist(accessToken, playlistId);
  const allPlaylistItems: Array<unknown> = await fetchAllPlaylistItems(accessToken, playlistId);

  // Extract and filter Spotify tracks
  const spotifyTracks: SimplifiedTrack[] = allPlaylistItems
    .filter((item: unknown) => {
      const typedItem = item as { track: unknown | null };
      // Drop items with no track (null OR undefined): removed/unavailable tracks
      // and local files come back without a usable track object.
      return typedItem.track != null;
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
      const largestImage = albumImages[0]?.url;

      return {
        id: typedItem.track.id,
        name: typedItem.track.name,
        artist: typedItem.track.artists[0]?.name || 'Unknown Artist',
        album: typedItem.track.album?.name || 'Unknown Album',
        albumArt: largestImage,
        duration_ms: typedItem.track.duration_ms,
        external_urls: typedItem.track.external_urls,
        preview_url: typedItem.track.preview_url || null,
      };
    });

  const totalTracksInPlaylist = spotifyPlaylist.trackTotal ?? spotifyTracks.length;
  const nullTracksCount = totalTracksInPlaylist - spotifyTracks.length;

  if (nullTracksCount > 0) {
    Logger.warn('Playlist contains unavailable tracks', {
      playlistId,
      totalTracks: totalTracksInPlaylist,
      availableTracks: spotifyTracks.length,
      unavailableTracks: nullTracksCount,
    });
  }

  Logger.info('Found Spotify tracks', { count: spotifyTracks.length });

  // Get YouTube videos if playlist exists and YouTube is connected
  let youtubeVideos: SimplifiedVideo[] = [];
  let hasYoutubePlaylist = false;

  if (youtube && youtubePlaylistId) {
    Logger.external('YouTube', 'Fetching playlist videos', { youtubePlaylistId });

    const allPlaylistItems = await fetchAllYoutubePlaylistItems(youtube, youtubePlaylistId, [
      'id',
      'snippet',
    ]);

    // Build video objects from the playlist-item snippets. Matching uses only
    // title + channelTitle, both available on the snippet, so no videos.list
    // call is needed.
    youtubeVideos = allPlaylistItems.map((item: YtPlaylistItem): SimplifiedVideo => ({
      id: item.snippet?.resourceId?.videoId || '',
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      // The video's real uploader, needed for official-video detection. snippet.channelTitle on
      // a playlist item is the PLAYLIST OWNER's channel, so using it made every match miss the
      // official-video bonus (scores capped low, and official picks fell below the link threshold).
      channelTitle: item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? undefined,
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        undefined,
      publishedAt: item.snippet?.publishedAt ?? undefined,
      url: `https://www.youtube.com/watch?v=${item.snippet?.resourceId?.videoId || ''}`,
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
            thumbnail: `https://img.youtube.com/vi/${matchedVideo.id}/mqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${matchedVideo.id}`,
          }
        : null,
      linked: !!matchedVideo,
      matchScore,
    };
  });

  // Add orphaned YouTube videos (not matched to any Spotify track)
  const matchedVideoIds =
    trackMatches.size > 0 ? Array.from(trackMatches.values()).map((v) => v.id) : [];
  const orphanedVideos = youtubeVideos
    .filter((v) => !matchedVideoIds.includes(v.id))
    .map((video: SimplifiedVideo): MergedTrack => ({
      spotify: null,
      youtube: {
        id: video.id,
        title: video.title,
        description: video.description,
        thumbnail: `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${video.id}`,
      },
      linked: false,
    }));

  const allTracks = [...mergedTracks, ...orphanedVideos];

  // A synced playlist "needs re-sync" when a sync would actually CHANGE it: the matched videos are
  // out of Spotify order, there are orphan videos, or a track is missing a video that a sync could
  // still find. Compares the desired order (matched videos in Spotify order) against the actual
  // YouTube order, using the same matching as sync.
  //
  // A contested track is excluded: its song already sits in the playlist under another track's
  // slot, so a search returns that same video and sync drops it as a duplicate. Counting those as
  // drift kept the flag permanently true and invited a re-sync that reconciles to 0 ops.
  let needsResync = false;
  if (hasYoutubePlaylist) {
    const desiredVideoIds = spotifyTracks
      .map((track) => trackMatches.get(track.id)?.id)
      .filter((id): id is string => !!id);
    const actualVideoIds = youtubeVideos.map((video) => video.id);
    const orderOrSetDiffers = desiredVideoIds.join(' ') !== actualVideoIds.join(' ');
    const resolvableUnlinked = spotifyTracks.filter(
      (track) => !trackMatches.has(track.id) && !matchingResult.contested.has(track.id),
    ).length;
    needsResync = orderOrSetDiffers || resolvableUnlinked > 0;
  }

  Logger.info('Playlist details processed', {
    totalSpotifyTracks: spotifyTracks.length,
    totalYoutubeVideos: youtubeVideos.length,
    matchedTracks: linkedCount,
    orphanedYoutubeVideos: orphanedVideos.length,
    totalTracks: allTracks.length,
    needsResync,
  });

  return {
    playlistId,
    playlistName: spotifyPlaylist.name,
    tracks: allTracks,
    linkedCount,
    totalTracks: spotifyTracks.length,
    hasYoutubePlaylist,
    needsResync,
  };
}
