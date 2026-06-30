/**
 * STEP 2 of sync: decide which tracks still need a video search.
 *
 * Update mode matches the playlist's existing YouTube videos against the Spotify
 * tracks (deterministic content matching) to separate already-synced tracks from
 * the ones still missing a video, and records the existing track->video pairs for
 * the reconcile desired order. Create mode simply takes tracks from the top.
 *
 * Pure (no API calls - existing items are already fetched), so it's unit-testable.
 */

import { YtPlaylistItem } from '../utils/youtubeClient';
import { optimalTrackMatching, SimplifiedTrack, SimplifiedVideo } from '../utils/trackMatching';
import { Logger } from '../utils/logger';

interface SpotifyPlaylistItem {
  track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null;
}

export interface ClassifiedTracks {
  /** Tracks to search for a video this operation (capped at trackLimit). */
  tracksToSearch: unknown[];
  /** Tracks already represented by a video in the playlist (update mode). */
  syncedTracks: unknown[];
  /** Tracks with no matching video yet (update mode). */
  unsyncedTracks: unknown[];
  /** Existing Spotify trackId -> YouTube videoId matches, for the desired order. */
  existingMatchPairs: Array<{ trackId: string; videoId: string }>;
}

const toSimplifiedTrack = (t: NonNullable<SpotifyPlaylistItem['track']>): SimplifiedTrack => ({
  id: t.id,
  name: t.name,
  artist: t.artists[0]?.name || 'Unknown Artist',
});

export function classifyTracksForSync(
  tracks: unknown[],
  existingItemsMap: Map<string, YtPlaylistItem>,
  opts: { isUpdateMode: boolean; trackLimit: number },
): ClassifiedTracks {
  const { isUpdateMode, trackLimit } = opts;

  if (!isUpdateMode) {
    // CREATE MODE: process up to trackLimit tracks from the beginning.
    return {
      tracksToSearch: tracks.slice(0, trackLimit),
      syncedTracks: [],
      unsyncedTracks: [],
      existingMatchPairs: [],
    };
  }

  // UPDATE MODE: build the existing videos and match against the Spotify tracks.
  const existingVideos: SimplifiedVideo[] = [];
  for (const item of existingItemsMap.values()) {
    const videoId = item.snippet?.resourceId?.videoId;
    if (videoId) {
      existingVideos.push({
        id: videoId,
        title: item.snippet?.title || 'Unknown',
        description: item.snippet?.description || '',
        channelTitle: item.snippet?.channelTitle || undefined,
      });
    }
  }

  const tracksToMatch: SimplifiedTrack[] = [];
  for (const item of tracks) {
    const track = (item as SpotifyPlaylistItem).track;
    if (track && track.type === 'track') tracksToMatch.push(toSimplifiedTrack(track));
  }

  const trackMatches = optimalTrackMatching(tracksToMatch, existingVideos);

  const syncedTracks: unknown[] = [];
  const unsyncedTracks: unknown[] = [];
  const existingMatchPairs: Array<{ trackId: string; videoId: string }> = [];

  for (const item of tracks) {
    const track = (item as SpotifyPlaylistItem).track;
    if (!track || track.type !== 'track') continue;
    const matchingVideo = trackMatches.matches.get(track.id);
    if (!matchingVideo) {
      unsyncedTracks.push(item);
    } else {
      syncedTracks.push(item);
      existingMatchPairs.push({ trackId: track.id, videoId: matchingVideo.id });
    }
  }

  Logger.info('Track matching analysis complete', {
    totalTracks: tracks.length,
    syncedTracks: syncedTracks.length,
    unsyncedTracks: unsyncedTracks.length,
    existingVideos: existingVideos.length,
  });

  return {
    tracksToSearch: unsyncedTracks.slice(0, trackLimit),
    syncedTracks,
    unsyncedTracks,
    existingMatchPairs,
  };
}
