import { sleep } from '../lib/delay';
import { Logger } from '../lib/logger';
import { ensureValidYouTubeToken } from '../youtube/auth';
import { findYoutubePlaylistItem } from '../youtube/playlist';
import { youtubeWrite } from '../youtube/writes';
import { addedVideoPosition } from './addedVideoPosition';

type YoutubeClient = Awaited<ReturnType<typeof ensureValidYouTubeToken>>['client'];

/** The video the user is replacing is not in the playlist; there is nothing to replace. */
export class VideoNotInPlaylistError extends Error {
  constructor(
    readonly videoId: string,
    readonly itemsScanned: number,
  ) {
    super(`Video ${videoId} is not in the playlist (checked ${itemsScanned} items)`);
    this.name = 'VideoNotInPlaylistError';
  }
}

export interface VideoChoiceResult {
  /** 'add' links a track that had no video; 'replace' swaps one the user rejected. */
  mode: 'add' | 'replace';
  /**
   * False when the video is in the playlist but could not be moved to its track's place. The write
   * landed, so this is not an error - but it is not what was asked for either, and the caller has
   * to say so rather than report plain success.
   */
  placed: boolean;
}

/** Moves a video already in the playlist to `position`. One write, 50 quota units. */
async function moveYoutubePlaylistItem(
  youtube: YoutubeClient,
  youtubePlaylistId: string,
  videoId: string,
  position: number,
): Promise<void> {
  const { item } = await findYoutubePlaylistItem(
    youtube,
    youtubePlaylistId,
    (candidate) => candidate.snippet?.resourceId?.videoId === videoId,
    ['snippet'],
  );
  if (!item?.id) throw new Error(`Added video ${videoId} is not in playlist ${youtubePlaylistId}`);

  await youtubeWrite('playlistItems.update', () =>
    youtube.playlistItems.update({
      part: ['snippet'],
      requestBody: {
        id: item.id!,
        snippet: {
          playlistId: youtubePlaylistId,
          position,
          resourceId: { kind: 'youtube#video', videoId },
        },
      },
    }),
  );
}

/**
 * Put the video the user picked into the playlist.
 *
 * A replace is already in order: the insert goes in at the old video's position and the old one
 * comes out, so the playlist is exactly as the user left it. An addition is appended and has to
 * move to its track's place - one write, at the position worked out from the Spotify order.
 *
 * Neither case reorders the rest of the playlist. Doing that made a one-video edit re-plan all of
 * it and pay 50 quota units per move: 84 moves for a single swap, against a daily budget of 10,000.
 * It also could not finish - YouTube aborted partway with a 409, leaving the order worse than
 * before and the next edit with more to undo. Drift is the sync button's job, where the user asks
 * for it and can see what it costs.
 */
export async function applyVideoChoice({
  youtube,
  youtubePlaylistId,
  spotifyAccessToken,
  spotifyPlaylistId,
  trackId,
  newVideoId,
  currentVideoId,
}: {
  youtube: YoutubeClient;
  youtubePlaylistId: string;
  spotifyAccessToken: string;
  spotifyPlaylistId: string;
  trackId: string;
  newVideoId: string;
  currentVideoId?: string;
}): Promise<VideoChoiceResult> {
  const isAddingNewVideo = !currentVideoId;

  if (!isAddingNewVideo) {
    Logger.info('Replacing existing video', { currentVideoId, newVideoId });

    const { item: playlistItemToReplace, itemsScanned } = await findYoutubePlaylistItem(
      youtube,
      youtubePlaylistId,
      (item) => item.snippet?.resourceId?.videoId === currentVideoId,
      ['snippet', 'contentDetails'],
    );

    if (!playlistItemToReplace) {
      Logger.error('Video not found in playlist after checking all pages', {
        currentVideoId,
        totalItemsChecked: itemsScanned,
      });
      throw new VideoNotInPlaylistError(currentVideoId, itemsScanned);
    }

    // Take the old video's place, so the playlist keeps the order the user left it in.
    const currentPosition = playlistItemToReplace.snippet?.position || 0;
    await youtubeWrite('playlistItems.insert', () =>
      youtube.playlistItems.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            playlistId: youtubePlaylistId,
            position: currentPosition,
            resourceId: { kind: 'youtube#video', videoId: newVideoId },
          },
        },
      }),
    );
    Logger.info('Added new video', { newVideoId, position: currentPosition });

    // The old one is now at position + 1, having been pushed down by the insert.
    await youtubeWrite('playlistItems.delete', () =>
      youtube.playlistItems.delete({ id: playlistItemToReplace.id! }),
    );
    Logger.info('Removed old video', { currentVideoId });

    return { mode: 'replace', placed: true };
  }

  // ADD MODE: append, then move it to its track's place.
  Logger.info('Adding new video to playlist', { newVideoId, trackId });
  await youtubeWrite('playlistItems.insert', () =>
    youtube.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          playlistId: youtubePlaylistId,
          resourceId: { kind: 'youtube#video', videoId: newVideoId },
        },
      },
    }),
  );
  Logger.info('Added new video successfully', { newVideoId });

  try {
    // YouTube will not move an item it has not finished registering.
    await sleep(3000);

    const position = await addedVideoPosition({
      youtube,
      youtubePlaylistId,
      spotifyAccessToken,
      spotifyPlaylistId,
      trackId,
      newVideoId,
    });

    if (position === null) {
      Logger.warn('Leaving the added video at the end: its track is no longer in Spotify', {
        trackId,
        newVideoId,
      });
      return { mode: 'add', placed: true };
    }

    await moveYoutubePlaylistItem(youtube, youtubePlaylistId, newVideoId, position);
    Logger.info('Placed the added video at its track’s position', {
      trackId,
      newVideoId,
      position,
    });
    return { mode: 'add', placed: true };
  } catch (placementError) {
    // The video is linked and in the playlist; only its position is wrong.
    Logger.error(
      'Could not place the added video at its position; it stays at the end',
      { trackId, newVideoId },
      placementError,
    );
    return { mode: 'add', placed: false };
  }
}
