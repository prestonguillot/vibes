import { fetchAllPlaylistItems } from '../spotify/playlistItems';
import { fetchAllYoutubePlaylistItems } from '../youtube/playlist';
import { ensureValidYouTubeToken } from '../youtube/auth';
import { optimalTrackMatching } from './trackMatching';

type YoutubeClient = Awaited<ReturnType<typeof ensureValidYouTubeToken>>['client'];

/** A Spotify track, reduced to what matching needs. */
export interface PositionTrack {
  id: string;
  name: string;
  artist: string;
}

/** A video already in the YouTube playlist. */
export interface PositionVideo {
  id: string;
  title: string;
  description: string;
  playlistItemId: string;
}

/**
 * Where a video the user picked by hand belongs in the YouTube playlist, so it lands beside its
 * track rather than at the end.
 *
 * Counts the tracks before this one that HAVE a video: a track nothing was found for occupies no
 * slot in the YouTube playlist, so counting it would push everything after it one place too far.
 *
 * Returns null when the track is no longer in the Spotify playlist, leaving the caller nothing to
 * do.
 */
export function positionForAddedVideo(
  tracks: PositionTrack[],
  videos: PositionVideo[],
  trackId: string,
  newVideoId: string,
): number | null {
  const trackIndex = tracks.findIndex((t) => t.id === trackId);
  if (trackIndex === -1) return null;

  const matches = optimalTrackMatching(tracks, videos).matches;

  let position = 0;
  for (const track of tracks.slice(0, trackIndex)) {
    const matched = matches.get(track.id);
    // The added video is matched to its own track by id, not by content - the user picked it
    // precisely because matching would not have. Counting it here would claim a slot twice.
    if (matched && matched.id !== newVideoId) position++;
  }
  return position;
}

/**
 * Reads only - the Spotify track order and the playlist's current contents, at a quota unit each -
 * then works out the position.
 */
export async function addedVideoPosition({
  youtube,
  youtubePlaylistId,
  spotifyAccessToken,
  spotifyPlaylistId,
  trackId,
  newVideoId,
}: {
  youtube: YoutubeClient;
  youtubePlaylistId: string;
  spotifyAccessToken: string;
  spotifyPlaylistId: string;
  trackId: string;
  newVideoId: string;
}): Promise<number | null> {
  const spotifyTracks = await fetchAllPlaylistItems(spotifyAccessToken, spotifyPlaylistId);
  const playlistItems = await fetchAllYoutubePlaylistItems(youtube, youtubePlaylistId, [
    'id',
    'snippet',
  ]);

  const tracks: PositionTrack[] = spotifyTracks
    .filter((item) => item.track && item.track.type === 'track')
    .map((item) => ({
      id: item.track!.id!,
      name: item.track!.name!,
      artist: item.track!.artists?.[0]?.name || 'Unknown Artist',
    }));

  const videos: PositionVideo[] = playlistItems
    .filter((item) => item.snippet?.resourceId?.videoId && item.id)
    .map((item) => ({
      id: item.snippet!.resourceId!.videoId!,
      title: item.snippet?.title || 'Unknown',
      description: item.snippet?.description || '',
      playlistItemId: item.id!,
    }));

  return positionForAddedVideo(tracks, videos, trackId, newVideoId);
}
