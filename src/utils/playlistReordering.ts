import { youtube_v3 } from 'googleapis';
import { Logger } from './logger';
import { optimalTrackMatching, SimplifiedTrack, SimplifiedVideo } from './trackMatching';
import { youtubeWrite } from './youtubeWrites';

interface ProgressCallback {
  (message: string, details?: string, percentage?: number): void;
}

/**
 * Reorders a YouTube playlist to match the order of tracks in Spotify
 * This is the shared implementation used by both sync operations and manual track linking
 */
export async function reorderPlaylistTracks(
  youtube: youtube_v3.Youtube,
  youtubePlaylistId: string,
  spotifyTracks: any[], // Array of spotify track items
  syncedTracks: any[], // Array of matched tracks
  onProgress?: ProgressCallback
): Promise<{ reorderedCount: number }> {

  if (syncedTracks.length === 0) {
    Logger.info('No existing synced tracks to reorder');
    return { reorderedCount: 0 };
  }

  Logger.info('Starting playlist reordering', {
    syncedTracksCount: syncedTracks.length,
    totalSpotifyTracks: spotifyTracks.length
  });

  if (onProgress) {
    onProgress('Reordering existing tracks', `Organizing ${syncedTracks.length} existing tracks to match Spotify order...`, 15);
  }

  // Create a map of Spotify tracks to their current positions
  const spotifyTrackPositions = new Map();
  for (let i = 0; i < spotifyTracks.length; i++) {
    const item = spotifyTracks[i];
    const typedItem = item as { track: { name: string; artists: Array<{ name?: string }>; type?: string } | null };
    if (typedItem.track && typedItem.track.type === 'track') {
      const track = typedItem.track;
      const trackKey = `${track.name.toLowerCase()}-${track.artists[0]?.name?.toLowerCase() || ''}`;
      spotifyTrackPositions.set(trackKey, i);
    }
  }

  Logger.info('Built Spotify track positions map', {
    totalSpotifyTracks: spotifyTracks.length,
    trackKeysCount: spotifyTrackPositions.size,
    firstFewTracks: Array.from(spotifyTrackPositions.entries()).slice(0, 5).map(([key, pos]) => ({ key, pos }))
  });

  // Get current YouTube playlist order to compare with target order
  // Use pagination to fetch ALL items, not just first 50
  const currentPlaylistItems: youtube_v3.Schema$PlaylistItem[] = [];
  let nextPageToken: string | undefined = undefined;

  do {
    const response: youtube_v3.Schema$PlaylistItemListResponse = await youtube.playlistItems.list({
      part: ['id', 'snippet'],
      playlistId: youtubePlaylistId,
      maxResults: 50,
      pageToken: nextPageToken
    }).then(res => res.data);

    if (response.items) {
      currentPlaylistItems.push(...response.items);
    }

    nextPageToken = response.nextPageToken || undefined;
  } while (nextPageToken);

  Logger.info('Fetched all playlist items for reordering', {
    totalItems: currentPlaylistItems.length,
    videoIds: currentPlaylistItems.map(item => item.snippet?.resourceId?.videoId).filter(Boolean),
    titles: currentPlaylistItems.map(item => item.snippet?.title).filter(Boolean)
  });

  const currentYouTubeOrder = currentPlaylistItems;

  // Create a map of current YouTube positions (by video ID)
  const currentPositions = new Map();
  for (let i = 0; i < currentYouTubeOrder.length; i++) {
    const item = currentYouTubeOrder[i];
    if (item.snippet?.resourceId?.videoId) {
      currentPositions.set(item.snippet.resourceId.videoId, {
        currentPosition: i,
        playlistItemId: item.id
      });
    }
  }

  // Build existingVideos array ONCE (not inside the loop)
  const existingVideos: SimplifiedVideo[] = [];
  for (const item of currentPlaylistItems) {
    if (item.snippet?.resourceId?.videoId && item.id) {
      existingVideos.push({
        id: item.snippet.resourceId.videoId,
        title: item.snippet?.title || 'Unknown',
        description: item.snippet?.description || '',
        playlistItemId: item.id
      });
    }
  }

  // Build arrays of tracks for optimal matching
  // Use ALL spotifyTracks, not just syncedTracks, to include newly added videos
  const tracksToMatch: SimplifiedTrack[] = [];
  for (const spotifyTrack of spotifyTracks) {
    const typedTrack = spotifyTrack as { track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null };
    if (typedTrack.track && typedTrack.track.type === 'track') {
      const track = typedTrack.track;
      tracksToMatch.push({
        id: track.id,
        name: track.name,
        artist: track.artists[0]?.name || 'Unknown Artist'
      });
    }
  }

  // Use optimal matching algorithm to resolve conflicts based on match quality
  const matchingResult = optimalTrackMatching(tracksToMatch, existingVideos);
  const trackMatches = matchingResult.matches; // Extract the matches Map from the result object

  // Build map of YouTube videoId to Spotify track info (including position)
  // This includes both manually added and synced videos
  const videoToSpotifyInfo = new Map<string, { videoId: string; spotifyPosition: number; trackId: string; trackName: string; artist: string }>();
  const videoIdToPlaylistItemId = new Map<string, string>();

  for (const item of currentYouTubeOrder) {
    if (!item.snippet?.resourceId?.videoId || !item.id) continue;

    const videoId = item.snippet.resourceId.videoId;
    videoIdToPlaylistItemId.set(videoId, item.id);

    // Find which Spotify track this video matches
    let matchedTrackId = '';
    for (const [trackId, videoInfo] of trackMatches.entries()) {
      if (videoInfo.id === videoId) {
        matchedTrackId = trackId;
        break;
      }
    }

    if (!matchedTrackId) continue;

    // Find Spotify position of this track
    for (let i = 0; i < spotifyTracks.length; i++) {
      const item = spotifyTracks[i];
      const typedItem = item as { track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null };
      if (typedItem.track?.id === matchedTrackId) {
        videoToSpotifyInfo.set(videoId, {
          videoId: videoId,
          spotifyPosition: i,
          trackId: matchedTrackId,
          trackName: typedItem.track.name,
          artist: typedItem.track.artists[0]?.name || 'Unknown Artist'
        });
        break;
      }
    }
  }

  // Separate videos into matched (synced with Spotify) and unmatched
  const matchedVideos: Array<{
    videoId: string,
    playlistItemId: string,
    spotifyPosition: number,
    trackName: string,
    artist: string,
    currentYouTubeIndex: number
  }> = [];

  const unmatchedVideos: Array<{
    videoId: string,
    playlistItemId: string,
    currentYouTubeIndex: number,
    title?: string
  }> = [];

  // Categorize each YouTube video
  currentYouTubeOrder.forEach((item, index) => {
    const videoId = item.snippet?.resourceId?.videoId;
    const playlistItemId = item.id;
    if (!videoId || !playlistItemId) return;

    const spotifyInfo = videoToSpotifyInfo.get(videoId);
    if (spotifyInfo) {
      matchedVideos.push({
        videoId,
        playlistItemId,
        spotifyPosition: spotifyInfo.spotifyPosition,
        trackName: spotifyInfo.trackName,
        artist: spotifyInfo.artist,
        currentYouTubeIndex: index
      });
    } else {
      unmatchedVideos.push({
        videoId,
        playlistItemId,
        currentYouTubeIndex: index,
        title: item.snippet?.title || undefined
      });
    }
  });

  // The target order: matched videos sorted by Spotify position, then unmatched videos
  const targetOrder: string[] = [
    ...[...matchedVideos].sort((a, b) => a.spotifyPosition - b.spotifyPosition).map(v => v.videoId),
    ...unmatchedVideos.map(v => v.videoId)
  ];

  // Current order in YouTube
  const currentOrder: string[] = currentYouTubeOrder
    .filter(item => item.snippet?.resourceId?.videoId)
    .map(item => item.snippet!.resourceId!.videoId!);

  // Check if reordering is needed
  let needsReordering = false;
  if (currentOrder.length !== targetOrder.length) {
    needsReordering = true;
  } else {
    for (let i = 0; i < currentOrder.length; i++) {
      if (currentOrder[i] !== targetOrder[i]) {
        needsReordering = true;
        break;
      }
    }
  }

  if (!needsReordering) {
    Logger.info('All tracks already in correct positions - skipping reordering phase');
    if (onProgress) {
      onProgress('Playlist order verified', `All ${syncedTracks.length} existing tracks are already in correct positions`, 25);
    }
    return { reorderedCount: 0 };
  }

  Logger.info('Reordering analysis', {
    currentOrder: currentOrder.map(id => {
      const matched = matchedVideos.find(v => v.videoId === id);
      const unmatched = unmatchedVideos.find(v => v.videoId === id);
      return matched ? `${matched.trackName} (Spotify #${matched.spotifyPosition})` :
             unmatched ? `${unmatched.title} (unmatched)` : id;
    }),
    targetOrder: targetOrder.map(id => {
      const matched = matchedVideos.find(v => v.videoId === id);
      const unmatched = unmatchedVideos.find(v => v.videoId === id);
      return matched ? `${matched.trackName} (Spotify #${matched.spotifyPosition})` :
             unmatched ? `${unmatched.title} (unmatched)` : id;
    })
  });

  // Calculate reordering operations needed
  const operations: Array<{
    videoId: string,
    playlistItemId: string,
    fromPosition: number,
    toPosition: number,
    trackName: string,
    artist: string
  }> = [];

  // Build video info map for operations
  const videoInfoMap = new Map<string, {
    playlistItemId: string,
    trackName: string,
    artist: string
  }>();

  for (const video of matchedVideos) {
    videoInfoMap.set(video.videoId, {
      playlistItemId: video.playlistItemId,
      trackName: video.trackName,
      artist: video.artist
    });
  }

  for (const video of unmatchedVideos) {
    videoInfoMap.set(video.videoId, {
      playlistItemId: video.playlistItemId,
      trackName: video.title || 'Unknown',
      artist: 'Unknown'
    });
  }

  // Calculate operations using Longest Increasing Subsequence (LIS) algorithm
  // This minimizes the number of moves needed by only moving videos that are out of order

  Logger.info('Starting reorder calculation with LIS algorithm', {
    currentOrder: currentOrder.slice(0, 10),
    targetOrder: targetOrder.slice(0, 10)
  });

  // Create a map of each video's target position
  const targetPositionMap = new Map<string, number>();
  for (let i = 0; i < targetOrder.length; i++) {
    targetPositionMap.set(targetOrder[i], i);
  }

  // Find the Longest Increasing Subsequence of videos already in correct relative order
  // Videos in the LIS don't need to be moved, only videos outside the LIS need moving
  const positions = currentOrder.map(videoId => targetPositionMap.get(videoId) ?? -1);

  // Calculate LIS using dynamic programming
  const lisLength = positions.length;
  const dp: number[] = Array(lisLength).fill(1);
  const parent: number[] = Array(lisLength).fill(-1);

  for (let i = 1; i < lisLength; i++) {
    for (let j = 0; j < i; j++) {
      if (positions[j] < positions[i] && dp[j] + 1 > dp[i]) {
        dp[i] = dp[j] + 1;
        parent[i] = j;
      }
    }
  }

  // Find the index with maximum LIS length
  let maxLen = 0;
  let maxIdx = -1;
  for (let i = 0; i < lisLength; i++) {
    if (dp[i] > maxLen && positions[i] !== -1) {
      maxLen = dp[i];
      maxIdx = i;
    }
  }

  // Reconstruct the LIS indices
  const lisIndices = new Set<number>();
  let idx = maxIdx;
  while (idx !== -1) {
    lisIndices.add(idx);
    idx = parent[idx];
  }

  Logger.info('Calculated LIS for reordering', {
    currentOrderLength: currentOrder.length,
    lisLength: maxLen,
    videosThatNeedMoving: currentOrder.length - maxLen,
    lisVideoIds: Array.from(lisIndices).map(i => ({
      index: i,
      videoId: currentOrder[i],
      targetPosition: targetPositionMap.get(currentOrder[i])
    }))
  });

  // Videos NOT in the LIS need to be moved
  const videosToMove = currentOrder.filter((_, i) => !lisIndices.has(i));

  // Simulate the final order by moving videos one-by-one
  const workingOrder = [...currentOrder];

  // Build a list of operations for videos that need to be moved
  // We'll process them in order to calculate correct final positions
  for (const videoId of videosToMove) {
    const currentPosition = workingOrder.indexOf(videoId);
    const targetPosition = targetPositionMap.get(videoId) ?? workingOrder.length;

    if (currentPosition !== -1 && targetPosition !== -1) {
      const info = videoInfoMap.get(videoId);
      if (!info) continue;

      Logger.info('Calculating reorder operation for out-of-order video', {
        track: info.trackName,
        videoId: videoId,
        currentPosition,
        targetPosition,
        workingOrderBefore: workingOrder.slice(0, 15)
      });

      operations.push({
        videoId: videoId,
        playlistItemId: info.playlistItemId,
        fromPosition: currentPosition,
        toPosition: targetPosition,
        trackName: info.trackName,
        artist: info.artist
      });

      // Simulate the move: remove and re-insert
      workingOrder.splice(currentPosition, 1);
      workingOrder.splice(targetPosition, 0, videoId);

      Logger.info('After simulation', {
        track: info.trackName,
        workingOrderAfter: workingOrder.slice(0, 15)
      });
    }
  }

  Logger.info('Calculated reordering operations', {
    operationsCount: operations.length,
    operations: operations.map(op => ({
      track: `${op.trackName} by ${op.artist}`,
      from: op.fromPosition,
      to: op.toPosition
    }))
  });

  // Execute the reordering operations
  let reorderedCount = 0;
  const totalOperations = operations.length;

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];

    if (onProgress) {
      const progressPercentage = 25 + Math.round((i / Math.max(totalOperations, 1)) * 60);
      onProgress('Reordering tracks', `Moving "${operation.trackName}" (${i + 1}/${totalOperations})`, progressPercentage);
    }

    try {
      Logger.info('Executing YouTube position update', {
        trackName: operation.trackName,
        playlistItemId: operation.playlistItemId,
        videoId: operation.videoId,
        fromPosition: operation.fromPosition,
        toPosition: operation.toPosition,
        operationIndex: i,
        totalOperations: operations.length
      });

      // CRITICAL: Use YouTube API UPDATE method to change position directly
      // NEVER use DELETE and INSERT - that's destructive and doesn't preserve order
      // See docs/YOUTUBE_REORDERING_PRINCIPLES.md for details
      const updateResult = await youtubeWrite('playlistItems.update', () => youtube.playlistItems.update({
        part: ['snippet'],
        requestBody: {
          id: operation.playlistItemId,
          snippet: {
            playlistId: youtubePlaylistId,
            position: operation.toPosition,
            resourceId: {
              kind: 'youtube#video',
              videoId: operation.videoId
            }
          }
        }
      }));

      reorderedCount++;
      Logger.info('Successfully reordered track', {
        trackName: operation.trackName,
        fromPosition: operation.fromPosition,
        toPosition: operation.toPosition,
        videoId: operation.videoId,
        resultPosition: updateResult.data?.snippet?.position
      });
    } catch (error: any) {
      Logger.error('Error reordering track', {
        trackName: operation.trackName,
        currentPosition: operation.fromPosition,
        targetPosition: operation.toPosition,
        videoId: operation.videoId
      }, error);

      // Continue with other operations even if one fails
      continue;
    }
  }

  Logger.info('Playlist reordering complete', {
    reorderedCount,
    totalOperations: operations.length
  });

  return { reorderedCount };
}