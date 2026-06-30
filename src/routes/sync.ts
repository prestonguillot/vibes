import { Router, Request, Response } from 'express';
import {
  YtPlaylist,
  YtPlaylistItem,
  YtPlaylistItemListResponse,
  YoutubeApiError,
} from '../utils/youtubeClient';
import { ensureValidYouTubeToken } from '../utils/youtubeAuth';
import { fetchAllPlaylistItems } from '../utils/spotifyPlaylistItems';
import { findSyncedYoutubePlaylist, syncedPlaylistTitle } from '../utils/youtubePlaylist';
import { youtubeWrite, YoutubeQuotaError } from '../utils/youtubeWrites';
import { reconcilePlaylist, buildSyncDesiredVideoIds } from '../utils/playlistReconcile';
import { Logger } from '../utils/logger';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { csrfValidationMiddleware } from '../utils/csrf';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { parseSpotifyTokenCookie, parseYouTubeTokenCookie } from '../utils/cookieParser';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';
import { formatErrorDetails } from '../utils/errorFormatter';
import { fetchPlaylistDetails } from '../services/playlistDetailsService';
import { searchTracksForVideos } from '../services/videoSearch';
import { classifyTracksForSync } from '../services/trackClassification';
import { ensureValidSpotifyToken } from '../utils/spotifyAuth';
import { getPlaylist } from '../utils/spotifyClient';
import { ProgressUpdate } from '../types/progress';

const router = Router();
const viewsPath = path.join(__dirname, '../../views');

type YoutubeClient = Awaited<ReturnType<typeof ensureValidYouTubeToken>>['client'];

// Helper function to get YouTube user ID from cached channel ID in tokens
function getYouTubeUserId(youtubeTokens: YouTubeTokens): string {
  if (!youtubeTokens.channel_id) {
    throw new Error('YouTube channel ID not found in tokens - re-authenticate with YouTube');
  }
  return youtubeTokens.channel_id;
}

function renderPartial(partial: string, data: Record<string, unknown>): Promise<string> {
  return ejs.renderFile(path.join(viewsPath, 'partials', partial), data);
}

interface SyncDeps {
  playlistId: string;
  batchSizeRaw: string | undefined;
  spotifyAccessToken: string;
  youtube: YoutubeClient;
  initialQuotaUsed: number;
  emit: (html: string) => void;
  emitProgress: (update: ProgressUpdate) => Promise<void>;
  /** Aborted when the client disconnects mid-sync. */
  signal?: AbortSignal;
}

// Runs the whole sync, streaming progress + the final result via the provided
// callbacks. Throws on real failures (the caller renders the error frame); the
// "nothing to sync" cases emit an error partial and return.
async function runSync(deps: SyncDeps): Promise<void> {
  const {
    playlistId,
    batchSizeRaw,
    spotifyAccessToken,
    youtube,
    initialQuotaUsed,
    emit,
    emitProgress,
    signal,
  } = deps;
  const startTime = Date.now();

  let apiCallCount = 0;
  let totalQuotaUsed = initialQuotaUsed;
  let existingPlaylist: YtPlaylist | null = null;

  await emitProgress({
    type: 'progress',
    message: 'Starting sync...',
    details: 'Fetching Spotify playlist details...',
  });

  // Get playlist details
  Logger.external('Spotify', 'Fetching playlist details');
  const playlist = await getPlaylist(spotifyAccessToken, playlistId);
  Logger.external('Spotify', 'Playlist details fetched', {
    name: playlist.name,
    totalTracks: playlist.trackTotal ?? 0,
  });

  // Get batch size, default to 1 if not provided
  let batchSize = 1;
  if (batchSizeRaw) {
    if (batchSizeRaw === 'all') {
      batchSize = playlist.trackTotal || 999;
    } else {
      batchSize = parseInt(batchSizeRaw);
    }
  }
  const trackLimit = batchSize;
  Logger.info('Using user-selected batch size', { batchSize, trackLimit });

  await emitProgress({
    type: 'progress',
    message: `Found playlist: "${playlist.name}"`,
    details: `Fetching tracks (limit: ${trackLimit})...`,
  });
  Logger.external('Spotify', 'Fetching all tracks for analysis');

  // Fetch all tracks via the /items endpoint (/tracks was removed in Feb 2026).
  const allItems = await fetchAllPlaylistItems(spotifyAccessToken, playlistId);
  const tracks: unknown[] = allItems.filter((item: unknown) => {
    const typedItem = item as { track: { type?: string } | null };
    return typedItem.track && typedItem.track.type === 'track';
  });
  Logger.info('Found valid tracks to analyze', {
    count: tracks.length,
    totalPlaylistTracks: playlist.trackTotal ?? 0,
  });

  await emitProgress({
    type: 'progress',
    message: `Processing ${tracks.length} tracks`,
    details: 'Searching for existing YouTube playlist...',
  });

  if (tracks.length === 0) {
    Logger.warn('No tracks to sync');
    emit(
      await renderPartial('sync-error.ejs', {
        playlistId,
        title: 'No Tracks Found',
        message: 'This playlist appears to be empty or contains only unplayable tracks.',
      }),
    );
    return;
  }

  // Total progress phases: search (70%) + playlist operations (30%)
  const SEARCH_PHASE_WEIGHT = 0.7;
  const PLAYLIST_PHASE_WEIGHT = 0.3;

  const logApiCall = (operation: string, quotaCost: number) => {
    apiCallCount++;
    totalQuotaUsed += quotaCost;
    Logger.external('YouTube', `API call: ${operation}`, {
      callNumber: apiCallCount,
      quotaCost,
      totalQuotaUsed,
    });
  };

  // STEP 1: Check if a YouTube playlist already exists FIRST
  const playlistTitle = syncedPlaylistTitle(playlist.name);
  Logger.external('YouTube', 'Checking for existing playlist before video search', {
    title: playlistTitle,
  });

  let youtubePlaylistId = '';
  const existingVideoIds: Set<string> = new Set();
  const existingItemsMap: Map<string, YtPlaylistItem> = new Map();
  let isUpdateMode = false;

  try {
    existingPlaylist = await findSyncedYoutubePlaylist(youtube, playlist.name);
    logApiCall('playlist search', 1);

    if (existingPlaylist) {
      youtubePlaylistId = existingPlaylist.id!;
      isUpdateMode = true;
      Logger.external('YouTube', 'Found existing playlist - entering UPDATE mode', {
        title: playlistTitle,
        id: youtubePlaylistId,
      });

      let nextPageToken: string | undefined = undefined;
      let totalExistingVideos = 0;
      do {
        const response: YtPlaylistItemListResponse = (
          await youtube.playlistItems.list({
            part: ['id', 'snippet'],
            playlistId: youtubePlaylistId,
            maxResults: 50,
            pageToken: nextPageToken,
          })
        ).data;
        logApiCall('get existing items', 1);

        const existingVideos = response.items || [];
        totalExistingVideos += existingVideos.length;
        for (const item of existingVideos) {
          if (item.snippet?.resourceId?.videoId) {
            const videoId = item.snippet.resourceId.videoId;
            existingVideoIds.add(videoId);
            existingItemsMap.set(videoId, item);
          }
        }
        nextPageToken = response.nextPageToken || undefined;
      } while (nextPageToken);

      Logger.info('Found existing videos in playlist', { count: totalExistingVideos });
    } else {
      Logger.info('No existing playlist found - entering CREATE mode');
    }
  } catch (error) {
    Logger.error('Error checking for existing playlist', {}, error);
    // Continue with creation flow
  }

  // STEP 2: Classify tracks - update mode matches existing videos to find which
  // tracks still need one; create mode takes from the top. Both capped at trackLimit.
  if (isUpdateMode) {
    await emitProgress({
      type: 'progress',
      message: 'Analyzing playlist for updates',
      details: `Found ${existingVideoIds.size} existing videos, matching tracks to identify unsynced ones...`,
      percentage: 5,
    });
  }
  const { tracksToSearch, unsyncedTracks, existingMatchPairs } = classifyTracksForSync(
    tracks,
    existingItemsMap,
    { isUpdateMode, trackLimit },
  );

  // STEP 3: Search YouTube (quota-free scraper) for a video per track, in order
  const { videoIds, searchResults } = await searchTracksForVideos(tracksToSearch, {
    isUpdateMode,
    existingVideoCount: existingVideoIds.size,
    totalTrackCount: tracks.length,
    searchPhaseWeight: SEARCH_PHASE_WEIGHT,
    emitProgress: (payload) => emitProgress(payload),
    signal,
  });

  // If the client disconnected during the search, stop before any YouTube write -
  // never modify the user's playlist for a sync they've navigated away from.
  if (signal?.aborted) return;

  await emitProgress({
    type: 'progress',
    message: `Found ${videoIds.length} music videos`,
    details: 'Checking for existing YouTube playlist...',
    percentage: Math.round(SEARCH_PHASE_WEIGHT * 100),
  });

  // STEP 4: Create or update YouTube playlist
  await emitProgress({
    type: 'progress',
    message: isUpdateMode
      ? `Updating existing playlist: "${playlistTitle}"`
      : 'Creating new YouTube playlist',
    details: isUpdateMode ? 'Processing playlist updates...' : 'Setting up new playlist...',
    percentage: Math.round(SEARCH_PHASE_WEIGHT * 100),
  });

  // Update with no unsynced tracks: still reconcile (order may have changed), then done.
  if (isUpdateMode && unsyncedTracks.length === 0 && videoIds.length === 0) {
    Logger.info('Playlist already fully synced, no new videos to add', { playlistId });

    const orderedTrackIds = tracks
      .map((item) => (item as { track?: { id?: string } }).track?.id)
      .filter((id): id is string => !!id);
    const desiredVideoIds = buildSyncDesiredVideoIds(
      orderedTrackIds,
      existingMatchPairs,
      searchResults,
    );
    const currentItems = Array.from(existingItemsMap.values())
      .filter((item) => item.snippet?.resourceId?.videoId && item.id)
      .map((item) => ({ videoId: item.snippet!.resourceId!.videoId!, playlistItemId: item.id! }));
    await reconcilePlaylist(youtube, youtubePlaylistId, desiredVideoIds, currentItems);

    const youtubePlaylistUrl = `https://www.youtube.com/playlist?list=${youtubePlaylistId}`;
    const syncFeedbackHtml = await renderPartial('sync-feedback.ejs', {
      playlistId,
      isUpdate: true,
      isFullySynced: true,
      videosFound: 0,
      totalSearched: 0,
      isLimited: false,
      unlinkedTracks: [],
    });
    const playlistDetails = await fetchPlaylistDetails(
      spotifyAccessToken,
      youtube,
      playlistId,
      youtubePlaylistId,
    );
    const playlistDetailsHtml = await renderPartial('playlist-details.ejs', {
      playlistId: playlistDetails.playlistId,
      playlistName: playlistDetails.playlistName,
      tracks: playlistDetails.tracks,
      linkedCount: playlistDetails.linkedCount,
      totalTracks: playlistDetails.totalTracks,
      hasYoutubeConnection: true,
      hasYoutubePlaylist: playlistDetails.hasYoutubePlaylist,
      needsResync: playlistDetails.needsResync,
    });
    emit(
      await renderPartial('sync-response.ejs', {
        playlistId,
        isUpdate: true,
        buttonText: 'Update YouTube Playlist',
        buttonClass: 'btn-outline-success',
        syncFeedbackHtml,
        playlistDetailsHtml,
        playlistName: playlist.name,
        trackCount: playlist.trackTotal ?? 0,
        spotifyUrl: playlist.spotifyUrl,
        youtubeUrl: youtubePlaylistUrl,
      }),
    );
    return;
  }

  // Only error on "no videos" for a NEW playlist. An update with nothing new is
  // valid (it may still reorder existing videos), so it falls through to reconcile.
  if (!isUpdateMode && videoIds.length === 0) {
    Logger.warn('No videos found for new sync');
    emit(
      await renderPartial('sync-error.ejs', {
        playlistId,
        title: 'No videos found',
        message: 'Could not find any YouTube videos for the tracks in this playlist.',
      }),
    );
    return;
  }

  // Create playlist if it doesn't exist
  if (!existingPlaylist) {
    const playlistResponse = await youtubeWrite('playlists.insert', () =>
      youtube.playlists.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: playlistTitle,
            description: `Synced from Spotify playlist: ${playlist.name}`,
          },
          status: { privacyStatus: 'private' },
        },
      }),
    );
    logApiCall('playlist creation', 50);
    youtubePlaylistId = playlistResponse.data.id!;
    Logger.external('YouTube', 'Created new playlist', {
      title: playlistTitle,
      id: youtubePlaylistId,
    });
    await emitProgress({
      type: 'progress',
      message: `Created playlist: "${playlistTitle}"`,
      details: 'Adding videos to new playlist...',
      percentage: Math.round(SEARCH_PHASE_WEIGHT * 100),
    });

    // A brand-new playlist isn't immediately writable - wait before the first insert.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const orderedTrackIds = tracks
      .map((item) => (item as { track?: { id?: string } }).track?.id)
      .filter((id): id is string => !!id);
    const desiredVideoIds = buildSyncDesiredVideoIds(orderedTrackIds, [], searchResults);
    const reconcileResult = await reconcilePlaylist(
      youtube,
      youtubePlaylistId,
      desiredVideoIds,
      [],
      (done, total) =>
        emitProgress({
          type: 'progress',
          message: 'Adding videos to playlist',
          details: `Adding videos (${done}/${total})`,
          percentage: Math.round(
            (SEARCH_PHASE_WEIGHT + (done / Math.max(total, 1)) * PLAYLIST_PHASE_WEIGHT) * 100,
          ),
        }),
    );
    logApiCall('reconcile new playlist', reconcileResult.inserted * 50);
    Logger.info('CREATE mode reconcile complete', { ...reconcileResult });
  } else {
    // UPDATE MODE: reconcile existing matches + this batch's new searches into order.
    Logger.info('UPDATE MODE: Adding videos for next unsynced tracks', {
      videosFoundForNextTracks: videoIds.length,
    });
    await emitProgress({
      type: 'progress',
      message: 'Adding new tracks to playlist',
      details: `Adding ${videoIds.length} new videos from next unsynced tracks...`,
      percentage: Math.round(SEARCH_PHASE_WEIGHT * 100),
    });

    const orderedTrackIds = tracks
      .map((item) => (item as { track?: { id?: string } }).track?.id)
      .filter((id): id is string => !!id);
    const desiredVideoIds = buildSyncDesiredVideoIds(
      orderedTrackIds,
      existingMatchPairs,
      searchResults,
    );
    const currentItems = Array.from(existingItemsMap.values())
      .filter((item) => item.snippet?.resourceId?.videoId && item.id)
      .map((item) => ({ videoId: item.snippet!.resourceId!.videoId!, playlistItemId: item.id! }));

    const reconcileResult = await reconcilePlaylist(
      youtube,
      youtubePlaylistId,
      desiredVideoIds,
      currentItems,
      (done, total) =>
        emitProgress({
          type: 'progress',
          message: 'Updating playlist',
          details: `Updating playlist (${done}/${total})`,
          percentage: Math.round(
            (SEARCH_PHASE_WEIGHT + (done / Math.max(total, 1)) * PLAYLIST_PHASE_WEIGHT) * 100,
          ),
        }),
    );
    logApiCall(
      'reconcile update',
      (reconcileResult.inserted + reconcileResult.moved + reconcileResult.deleted) * 50,
    );
    Logger.info('UPDATE mode reconcile complete', { ...reconcileResult });
  }

  Logger.requestEnd('Sync Request Completed', Date.now() - startTime);

  const youtubePlaylistUrl = `https://www.youtube.com/playlist?list=${youtubePlaylistId}`;
  await emitProgress({
    type: 'complete',
    message: `Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!`,
    details: `Found ${searchResults.filter((r) => r.found).length} out of ${searchResults.length} tracks${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}`,
    percentage: 100,
  });

  Logger.info('YouTube API Quota Usage Summary', {
    totalApiCalls: apiCallCount,
    totalQuotaUsed,
    operationType: existingPlaylist ? 'UPDATE' : 'SYNC',
    playlistName: playlist.name,
    playlistId,
    tracksProcessed: searchResults.length,
    videosFound: searchResults.filter((r) => r.found).length,
    quotaSaved: searchResults.length * 100,
  });

  // Final result: feedback + OOB playlist-details + button.
  const videosFound = searchResults.filter((r) => r.found).length;
  const unlinkedTracks = searchResults
    .filter((r) => !r.found)
    .map((r) => ({ track: r.track, artist: r.artist }));
  const syncFeedbackHtml = await renderPartial('sync-feedback.ejs', {
    playlistId,
    isUpdate: !!existingPlaylist,
    videosFound,
    totalSearched: searchResults.length,
    isLimited: tracks.length > trackLimit,
    totalTracks: tracks.length,
    unlinkedTracks,
  });
  const playlistDetails = await fetchPlaylistDetails(
    spotifyAccessToken,
    youtube,
    playlistId,
    youtubePlaylistId,
  );
  const playlistDetailsHtml = await renderPartial('playlist-details.ejs', {
    playlistId: playlistDetails.playlistId,
    playlistName: playlistDetails.playlistName,
    tracks: playlistDetails.tracks,
    linkedCount: playlistDetails.linkedCount,
    totalTracks: playlistDetails.totalTracks,
    hasYoutubeConnection: true,
    hasYoutubePlaylist: playlistDetails.hasYoutubePlaylist,
    needsResync: playlistDetails.needsResync,
  });
  emit(
    await renderPartial('sync-response.ejs', {
      playlistId,
      syncFeedbackHtml,
      buttonText: 'Update YouTube Playlist',
      buttonClass: 'btn-outline-success',
      playlistName: playlist.name,
      trackCount: tracks.length,
      spotifyUrl: playlist.spotifyUrl,
      youtubeUrl: youtubePlaylistUrl,
      playlistDetailsHtml,
    }),
  );
}

// POST returns the SSE subscriber fragment (CSRF-protected); it does no work.
// The subscriber connects to the stream below, which runs the sync.
router.post(
  '/playlist/:playlistId',
  csrfValidationMiddleware,
  validate({
    params: z.object({ playlistId: schemas.spotifyPlaylistId }),
    body: z.object({ batchSize: schemas.batchSize.optional() }),
  }),
  async (
    req: ValidatedRequest<{ playlistId: string }, Record<string, unknown>, { batchSize?: string }>,
    res,
  ) => {
    const html = await renderPartial('sync-subscriber.ejs', {
      id: req.params.playlistId,
      batchSize: req.body.batchSize || '1',
    });
    res.send(html);
  },
);

// SSE stream: authenticates (before opening the stream, so token-refresh cookies
// can be set), then runs the sync and streams progress -> result -> errors as
// `message` frames, ending with a `close` frame. Same-origin only (SameSite=strict
// cookies) so a GET trigger is CSRF-safe.
router.get(
  '/playlist/:playlistId/stream',
  validate({
    params: z.object({ playlistId: schemas.spotifyPlaylistId }),
    query: z.object({ batchSize: schemas.batchSize.optional() }),
  }),
  async (req: ValidatedRequest<{ playlistId: string }, { batchSize?: string }>, res: Response) => {
    const playlistId = req.params.playlistId;
    Logger.requestStart('Sync stream started', { playlistId, requestUrl: req.originalUrl });

    // --- Authentication (must complete before the SSE headers are written) ---
    const spotifyTokens: SpotifyTokens | null = parseSpotifyTokenCookie(
      req.cookies.spotify_tokens,
      res,
    );
    const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(
      req.cookies.youtube_tokens,
      res,
    );
    if (!spotifyTokens || !youtubeTokens) {
      const service = !spotifyTokens ? 'Spotify' : 'YouTube';
      const html = await renderPartial('sync-error.ejs', {
        playlistId,
        title: `${service} Authentication Required`,
        message: `Please connect to ${service} first using the connection button at the top of the page.`,
      });
      return res.status(401).send(html);
    }

    let spotifyAccessToken: string;
    let youtube: YoutubeClient;
    let initialQuotaUsed: number;
    try {
      spotifyAccessToken = await ensureValidSpotifyToken(req as Request, res);
      const yt = await ensureValidYouTubeToken(req as Request, res);
      youtube = yt.client;
      initialQuotaUsed = yt.quotaUsed;
      getYouTubeUserId(youtubeTokens); // validates channel id is present
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'SPOTIFY_AUTH_REQUIRED' || error.message === 'YOUTUBE_AUTH_REQUIRED')
      ) {
        const service = error.message === 'SPOTIFY_AUTH_REQUIRED' ? 'Spotify' : 'YouTube';
        const loginUrl =
          error.message === 'SPOTIFY_AUTH_REQUIRED' ? '/auth/spotify/login' : '/auth/youtube/login';
        const html = await renderPartial('auth-expired.ejs', { service, loginUrl });
        return res.status(401).send(html);
      }
      Logger.error('Sync stream auth failed', { playlistId }, error);
      const html = await renderPartial('sync-error.ejs', {
        playlistId,
        title: 'Authentication Error',
        message: 'Failed to verify your connection. Please try reconnecting.',
      });
      return res.status(500).send(html);
    }

    // --- Open the stream ---
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': stream open\n\n');

    const emit = (html: string) => {
      if (res.writable && !res.writableEnded) {
        res.write(`event: message\ndata: ${html.replace(/\s+/g, ' ').trim()}\n\n`);
      }
    };
    const emitProgress = async (update: ProgressUpdate) => {
      emit(
        await renderPartial('progress-update.ejs', {
          message: update.message,
          details: update.details,
          percentage: update.percentage || 0,
          type: update.type,
        }),
      );
    };

    const abortController = new AbortController();
    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
      abortController.abort();
    });

    try {
      await runSync({
        playlistId,
        batchSizeRaw: req.query.batchSize,
        spotifyAccessToken,
        youtube,
        initialQuotaUsed,
        emit,
        emitProgress,
        signal: abortController.signal,
      });
    } catch (error) {
      Logger.error('Error syncing playlist', {}, error);
      let html: string;
      // Writes surface quota as YoutubeQuotaError; reads as a 403 YoutubeApiError.
      if (
        error instanceof YoutubeQuotaError ||
        (error instanceof YoutubeApiError &&
          error.code === 403 &&
          (error.reason === 'quotaExceeded' || error.reason === 'rateLimitExceeded'))
      ) {
        Logger.warn('YouTube API quota exceeded');
        html = await renderPartial('sync-error.ejs', {
          playlistId,
          title: 'YouTube Quota Exceeded',
          message: 'Your YouTube API quota has been exceeded. YouTube limits API usage per day.',
          details:
            'The quota resets at midnight Pacific Time. You can continue using the app with existing playlists, but cannot sync new content until the quota resets.',
        });
      } else {
        html = await renderPartial('sync-error.ejs', {
          playlistId,
          title: 'Error syncing playlist',
          message: `Something went wrong during the sync process. Please try again. Details: ${formatErrorDetails(error)}`,
        });
      }
      emit(html);
    } finally {
      if (!clientClosed && res.writable && !res.writableEnded) {
        res.write('event: close\ndata: {}\n\n');
        res.end();
      }
    }
    return;
  },
);

export { router as syncRouter };
