import { Router, Request, Response } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google, youtube_v3 } from 'googleapis';

// The exact OAuth2 client instance type google.auth.OAuth2 produces (googleapis
// bundles its own google-auth-library copy, so referencing it directly avoids a
// duplicate-type mismatch).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
import { searchMusicVideo } from '../utils/youtubeScraper';
import { fetchAllPlaylistItems } from '../utils/spotifyPlaylistItems';
import { findSyncedYoutubePlaylist, syncedPlaylistTitle } from '../utils/youtubePlaylist';
import { youtubeWrite } from '../utils/youtubeWrites';
import { reconcilePlaylist, buildSyncDesiredVideoIds } from '../utils/playlistReconcile';
import { sendProgressUpdate, closeProgressConnections } from './progress';
import { Logger } from '../utils/logger';
import { getSecureCookieOptions } from '../utils/authValidation';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { csrfValidationMiddleware } from '../utils/csrf';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { parseSpotifyTokenCookie, parseYouTubeTokenCookie, validateAndSerializeSpotifyTokens, validateAndSerializeYouTubeTokens } from '../utils/cookieParser';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';
import { formatErrorDetails } from '../utils/errorFormatter';
import { fetchPlaylistDetails } from '../services/playlistDetailsService';
import { searchTracksForVideos } from '../services/videoSearch';
import { classifyTracksForSync } from '../services/trackClassification';

const router = Router();

// Helper functions for token refresh
const ensureValidSpotifyToken = async (req: Request, res: Response): Promise<SpotifyWebApi> => {
  const spotifyTokens: SpotifyTokens | null = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);

  if (!spotifyTokens) {
    throw new Error('No Spotify tokens found');
  }

  const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
  });

  spotifyApi.setAccessToken(spotifyTokens.accessToken);
  spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

  try {
    await spotifyApi.getMe();
    return spotifyApi;
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 401 && spotifyTokens.refreshToken) {
      Logger.auth('Spotify', 'token expired, refreshing');
      try {
        const data = await spotifyApi.refreshAccessToken();
        const { access_token } = data.body;

        // Validate and update cookie with new token
        const updatedTokens = { ...spotifyTokens, accessToken: access_token };
        const serializedTokens = validateAndSerializeSpotifyTokens(updatedTokens);
        res.cookie('spotify_tokens', serializedTokens, getSecureCookieOptions());
        spotifyApi.setAccessToken(access_token);

        Logger.auth('Spotify', 'token refreshed successfully');
        return spotifyApi;
      } catch (refreshError) {
        Logger.error('Failed to refresh Spotify token', {}, refreshError);
        throw new Error('SPOTIFY_AUTH_REQUIRED');
      }
    } else {
      throw new Error('SPOTIFY_AUTH_REQUIRED');
    }
  }
};

// Helper function to get YouTube user ID from cached channel ID in tokens
function getYouTubeUserId(youtubeTokens: YouTubeTokens): string {
  if (!youtubeTokens.channel_id) {
    throw new Error('YouTube channel ID not found in tokens - re-authenticate with YouTube');
  }
  return youtubeTokens.channel_id;
}

// Helper function to ensure valid YouTube token and return quota usage
async function ensureValidYouTubeToken(req: Request, res: Response): Promise<{ oauth2Client: OAuth2Client, quotaUsed: number }> {
  const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);

  if (!youtubeTokens) {
    throw new Error('YOUTUBE_AUTH_REQUIRED');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  oauth2Client.setCredentials(youtubeTokens);

  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    Logger.external('YouTube', 'Token validation successful', { quotaUsed: 1 });
    return { oauth2Client, quotaUsed: 1 }; // channels.list costs 1 unit
  } catch (error: unknown) {
    const errorCode = (error as { code?: number }).code;
    if (errorCode === 401 && youtubeTokens.refresh_token) {
      Logger.auth('YouTube', 'token expired, refreshing');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Validate and update cookie with new tokens
        const updatedTokens = {
          ...youtubeTokens,
          ...credentials
        };
        const serializedTokens = validateAndSerializeYouTubeTokens(updatedTokens);
        res.cookie('youtube_tokens', serializedTokens, getSecureCookieOptions());
        oauth2Client.setCredentials(updatedTokens);

        Logger.auth('YouTube', 'token refreshed successfully');
        return { oauth2Client, quotaUsed: 1 }; // refreshAccessToken costs 1 unit
      } catch (refreshError) {
        Logger.error('Failed to refresh YouTube token', {}, refreshError);
        throw new Error('YOUTUBE_AUTH_REQUIRED');
      }
    } else {
      throw new Error('YOUTUBE_AUTH_REQUIRED');
    }
  }
};

router.post('/playlist/:playlistId',
  csrfValidationMiddleware, // CSRF protection
  validate({
    params: z.object({
      playlistId: schemas.spotifyPlaylistId
    }),
    body: z.object({
      batchSize: schemas.batchSize.optional()
    })
  }),
  async (req: ValidatedRequest<
    { playlistId: string },
    Record<string, unknown>,
    { batchSize?: string }
  >, res) => {
  const startTime = Date.now();
  const playlistId = req.params.playlistId;

  Logger.requestStart('Sync Request Started', {
    playlistId,
    requestUrl: req.originalUrl,
    method: req.method
  });

  // Declare variables outside try block so they're accessible in catch
  let apiCallCount = 0;
  let totalQuotaUsed = 0;
  let existingPlaylist: youtube_v3.Schema$Playlist | null = null;
  let youtubeUserId: string = '';

  try {
    // Check authentication
    const spotifyTokens: SpotifyTokens | null = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);
    const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);

    if (!spotifyTokens) {
      Logger.error('No Spotify tokens in cookies');
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-error.ejs'), {
        playlistId: 'unknown',
        title: 'Spotify Authentication Required',
        message: 'Please connect to Spotify first using the Spotify connection button at the top of the page.'
      });
      return res.status(401).send(html);
    }

    if (!youtubeTokens) {
      Logger.error('No YouTube tokens in cookies');
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-error.ejs'), {
        playlistId: 'unknown',
        title: 'YouTube Authentication Required',
        message: 'Please connect to YouTube first using the YouTube connection button at the top of the page.'
      });
      return res.status(401).send(html);
    }

    // Get YouTube user ID for isolating SSE connections
    youtubeUserId = await getYouTubeUserId(youtubeTokens);
    Logger.info('YouTube user ID obtained', { playlistId, youtubeUserId });

    // Send initial progress update (now that we have youtubeUserId)
    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'progress',
      message: 'Starting sync...',
      details: 'Checking authentication and initializing APIs'
    });

    Logger.info('Authentication check passed');

    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'progress',
      message: 'Authentication verified',
      details: 'Initializing API clients...'
    });

    // Initialize APIs
    Logger.info('Initializing API clients');
    const spotifyApi = await ensureValidSpotifyToken(req as Request, res);
    const { oauth2Client, quotaUsed } = await ensureValidYouTubeToken(req as Request, res);
    totalQuotaUsed = quotaUsed; // Initialize totalQuotaUsed with initial quota
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    Logger.info('API clients initialized');

    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'progress',
      message: 'APIs initialized',
      details: 'Fetching Spotify playlist details...'
    });

    // Get playlist details
    Logger.external('Spotify', 'Fetching playlist details');
    const playlistResponse = await spotifyApi.getPlaylist(playlistId);
    const playlist = playlistResponse.body;
    Logger.external('Spotify', 'Playlist details fetched', { name: playlist.name, totalTracks: playlist.tracks?.total ?? 0 });

    // Get batch size from request, default to 1 if not provided
    let batchSize = 1;
    if (req.body.batchSize) {
      if (req.body.batchSize === 'all') {
        // "all" means process all tracks (use playlist total)
        batchSize = playlist.tracks?.total || 999;
      } else {
        batchSize = parseInt(req.body.batchSize);
      }
    }
    const trackLimit = batchSize; // Use user-selected batch size

    Logger.info('Using user-selected batch size', { batchSize, trackLimit });

    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'progress',
      message: `Found playlist: "${playlist.name}"`,
      details: `Fetching tracks (limit: ${trackLimit})...`
    });
    Logger.external('Spotify', 'Fetching all tracks for analysis');

    // Fetch all tracks via the /items endpoint. The library's getPlaylistTracks()
    // uses the /tracks endpoint that Spotify removed in Feb 2026 (now 403); see
    // fetchAllPlaylistItems.
    const spotifyAccessToken = spotifyApi.getAccessToken();
    if (!spotifyAccessToken) {
      throw new Error('Spotify access token unavailable for fetching playlist items');
    }
    const allItems = await fetchAllPlaylistItems(spotifyAccessToken, playlistId);
    const allTracks: unknown[] = allItems.filter((item: unknown) => {
      const typedItem = item as { track: { type?: string } | null };
      return typedItem.track && typedItem.track.type === 'track';
    });

    const tracks = allTracks;
    Logger.info('Found valid tracks to analyze', { count: tracks.length, totalPlaylistTracks: playlist.tracks?.total ?? 0 });

    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'progress',
      message: `Processing ${tracks.length} tracks`,
      details: 'Searching for existing YouTube playlist...',
      currentTrack: 0,
      totalTracks: tracks.length
    });

    if (tracks.length === 0) {
      Logger.warn('No tracks to sync');
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'error',
        message: 'No tracks found',
        details: 'No tracks found in the playlist'
      });

      closeProgressConnections(playlistId, youtubeUserId);

      // Return error in sync-result div for sync.js to handle
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-error.ejs'), {
        playlistId,
        title: 'No Tracks Found',
        message: 'This playlist appears to be empty or contains only unplayable tracks.'
      });
      return res.send(html);
    }

    // Calculate total progress phases: search (70%) + playlist operations (30%)
    const SEARCH_PHASE_WEIGHT = 0.7;
    const PLAYLIST_PHASE_WEIGHT = 0.3;

    // Helper function to log API calls with correct quota costs
    const logApiCall = (operation: string, quotaCost: number) => {
      apiCallCount++;
      totalQuotaUsed += quotaCost;
      Logger.external('YouTube', `API call: ${operation}`, { callNumber: apiCallCount, quotaCost, totalQuotaUsed });
    };

    // STEP 1: Check if a YouTube playlist already exists FIRST
    const playlistTitle = syncedPlaylistTitle(playlist.name);
    Logger.external('YouTube', 'Checking for existing playlist before video search', { title: playlistTitle });

    let youtubePlaylistId: string = '';
    let existingVideoIds: Set<string> = new Set();
    let existingItemsMap: Map<string, youtube_v3.Schema$PlaylistItem> = new Map();
    let isUpdateMode = false;

    try {
      // Paginates over all playlists, so a match beyond the first 50 is found.
      existingPlaylist = await findSyncedYoutubePlaylist(youtube, playlist.name);
      logApiCall('playlist search', 1);

      if (existingPlaylist) {
        youtubePlaylistId = existingPlaylist.id!;
        isUpdateMode = true;
        Logger.external('YouTube', 'Found existing playlist - entering UPDATE mode', { title: playlistTitle, id: youtubePlaylistId });

        // Get existing videos to determine which tracks are already synced
        // IMPORTANT: Paginate through ALL items, not just first 50
        let nextPageToken: string | undefined = undefined;
        let totalExistingVideos = 0;

        do {
          const response: youtube_v3.Schema$PlaylistItemListResponse = (await youtube.playlistItems.list({
            part: ['id', 'snippet'],
            playlistId: youtubePlaylistId,
            maxResults: 50,
            pageToken: nextPageToken
          })).data;

          logApiCall('get existing items', 1);

          const existingVideos = response.items || [];
          totalExistingVideos += existingVideos.length;

          // Map existing videos
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
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'progress',
        message: 'Analyzing playlist for updates',
        details: `Found ${existingVideoIds.size} existing videos, matching tracks to identify unsynced ones...`,
        percentage: 5
      });
    }
    const { tracksToSearch, unsyncedTracks, existingMatchPairs } =
      classifyTracksForSync(tracks, existingItemsMap, { isUpdateMode, trackLimit });
    
    // STEP 3: Search YouTube (quota-free scraper) for a video per track, in order
    const { videoIds, searchResults } = await searchTracksForVideos(tracksToSearch, {
      isUpdateMode,
      existingVideoCount: existingVideoIds.size,
      totalTrackCount: tracks.length,
      searchPhaseWeight: SEARCH_PHASE_WEIGHT,
      emitProgress: (payload) => sendProgressUpdate(playlistId, youtubeUserId, payload)
    });
    
    // After search phase completes, we're at 70% progress
    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'progress',
      message: `Found ${videoIds.length} music videos`,
      details: 'Checking for existing YouTube playlist...',
      percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
    });
    
    // STEP 4: Create or update YouTube playlist
    if (isUpdateMode) {
      // UPDATE MODE: Update existing playlist
      Logger.external('YouTube', 'Updating existing playlist', { title: playlistTitle, id: youtubePlaylistId });
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'progress',
        message: `Updating existing playlist: "${playlistTitle}"`,
        details: 'Processing playlist updates...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
    } else {
      // CREATE MODE: Create new playlist
      Logger.external('YouTube', 'Creating new playlist', { title: playlistTitle });
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'progress',
        message: `Creating new YouTube playlist`,
        details: 'Setting up new playlist...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
    }
    
    // Check if this is an update with no unsynced tracks (playlist already fully synced)
    if (isUpdateMode && unsyncedTracks.length === 0 && videoIds.length === 0) {
      Logger.info('Playlist already fully synced, no new videos to add', { playlistId });

      // Still reconcile: the Spotify order may have changed or tracks been removed
      // even when nothing new needs adding. No-op when already identical; the
      // delete-safety rail protects against a bad desired order.
      const orderedTrackIds = tracks
        .map(item => (item as { track?: { id?: string } }).track?.id)
        .filter((id): id is string => !!id);
      const desiredVideoIds = buildSyncDesiredVideoIds(orderedTrackIds, existingMatchPairs, searchResults);
      const currentItems = Array.from(existingItemsMap.values())
        .filter(item => item.snippet?.resourceId?.videoId && item.id)
        .map(item => ({ videoId: item.snippet!.resourceId!.videoId!, playlistItemId: item.id! }));
      await reconcilePlaylist(youtube, youtubePlaylistId, desiredVideoIds, currentItems);

      closeProgressConnections(playlistId, youtubeUserId);

      // Return success response - playlist is up to date
      const youtubePlaylistUrl = `https://www.youtube.com/playlist?list=${youtubePlaylistId}`;
      const syncFeedbackHtml = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/sync-feedback.ejs'),
        {
          playlistId,
          isUpdate: true,
          isFullySynced: true,
          videosFound: 0,
          totalSearched: 0,
          isLimited: false,
          unlinkedTracks: []
        }
      );

      // Fetch updated playlist details to send as OOB swap
      const playlistDetails = await fetchPlaylistDetails(spotifyApi, youtube, playlistId, youtubePlaylistId);

      // Generate playlist details HTML using shared template
      const viewsPath = path.join(__dirname, '../../views');
      const playlistDetailsHtml = await ejs.renderFile(path.join(viewsPath, 'partials/playlist-details.ejs'), {
        playlistId: playlistDetails.playlistId,
        playlistName: playlistDetails.playlistName,
        tracks: playlistDetails.tracks,
        linkedCount: playlistDetails.linkedCount,
        totalTracks: playlistDetails.totalTracks,
        hasYoutubeConnection: true,
        hasYoutubePlaylist: playlistDetails.hasYoutubePlaylist
      });

      return res.send(
        await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-response.ejs'), {
          playlistId,
          isUpdate: true,
          buttonText: 'Update YouTube Playlist',
          buttonClass: 'btn-outline-success',
          syncFeedbackHtml,
          playlistDetailsHtml,
          playlistName: playlist.name,
          trackCount: playlist.tracks?.total ?? 0,
          spotifyUrl: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`,
          youtubeUrl: youtubePlaylistUrl
        })
      );
    }

    // Only error on "no videos" for a NEW playlist. An update with nothing new is
    // valid (it may still reorder existing videos), so it falls through to reconcile.
    if (!isUpdateMode && videoIds.length === 0) {
      Logger.warn('No videos found for new sync');
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'error',
        message: 'No videos found',
        details: 'No videos found in the playlist'
      });
      // Log API usage to server logs only (not exposed to client)
      Logger.info('Sync operation completed with no matches', {
        apiCallCount,
        totalQuotaUsed,
        playlistId
      });

      closeProgressConnections(playlistId, youtubeUserId);

      // Return error in sync-result div for sync.js to handle
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-error.ejs'), {
        playlistId,
        title: 'No videos found',
        message: 'Could not find any YouTube videos for the tracks in this playlist.'
      });
      return res.send(html);
    }
    
    // Create playlist if it doesn't exist
    if (!existingPlaylist) {
      const playlistResponse = await youtubeWrite('playlists.insert', () => youtube.playlists.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: playlistTitle,
            description: `Synced from Spotify playlist: ${playlist.name}`,
          },
          status: {
            privacyStatus: 'private',
          }
        }
      }));
      
      logApiCall('playlist creation', 50); // playlists.insert costs 50 units
      
      youtubePlaylistId = playlistResponse.data.id!;
      Logger.external('YouTube', 'Created new playlist', { title: playlistTitle, id: youtubePlaylistId });
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'progress',
        message: `Created playlist: "${playlistTitle}"`,
        details: 'Adding videos to new playlist...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });

      // A brand-new playlist isn't immediately writable - YouTube needs a moment
      // to propagate it, otherwise the first playlistItems.insert fails. Wait
      // before adding the first video.
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Reconcile the brand-new (empty) playlist to the desired order: every
      // found video inserted at its Spotify position, in one pass. Errors
      // propagate to the outer catch rather than being swallowed per-track.
      const orderedTrackIds = tracks
        .map(item => (item as { track?: { id?: string } }).track?.id)
        .filter((id): id is string => !!id);
      const desiredVideoIds = buildSyncDesiredVideoIds(orderedTrackIds, [], searchResults);

      const reconcileResult = await reconcilePlaylist(
        youtube, youtubePlaylistId, desiredVideoIds, [],
        (done, total) => sendProgressUpdate(playlistId, youtubeUserId, {
          type: 'progress',
          message: 'Adding videos to playlist',
          details: `Adding videos (${done}/${total})`,
          percentage: Math.round((SEARCH_PHASE_WEIGHT + (done / Math.max(total, 1)) * PLAYLIST_PHASE_WEIGHT) * 100)
        })
      );
      logApiCall('reconcile new playlist', reconcileResult.inserted * 50);
      Logger.info('CREATE mode reconcile complete', reconcileResult);

    } else {
      // UPDATE MODE: Add the videos found for next unsynced tracks
      Logger.info('UPDATE MODE: Adding videos for next unsynced tracks');
      
      Logger.info('UPDATE MODE: Video analysis for next tracks', {
        videosFoundForNextTracks: videoIds.length
      });
      
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'progress',
        message: `Adding new tracks to playlist`,
        details: `Adding ${videoIds.length} new videos from next unsynced tracks...`,
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
      
      // Build the desired order (existing matches + this batch's new searches, in
      // Spotify order) and reconcile in one pass: insert new at position, move
      // existing into order, delete genuine orphans. The delete-safety rail in
      // reconcilePlaylist refuses to run if this would delete most of the playlist.
      const orderedTrackIds = tracks
        .map(item => (item as { track?: { id?: string } }).track?.id)
        .filter((id): id is string => !!id);
      const desiredVideoIds = buildSyncDesiredVideoIds(orderedTrackIds, existingMatchPairs, searchResults);

      const currentItems = Array.from(existingItemsMap.values())
        .filter(item => item.snippet?.resourceId?.videoId && item.id)
        .map(item => ({ videoId: item.snippet!.resourceId!.videoId!, playlistItemId: item.id! }));

      const reconcileResult = await reconcilePlaylist(
        youtube, youtubePlaylistId, desiredVideoIds, currentItems,
        (done, total) => sendProgressUpdate(playlistId, youtubeUserId, {
          type: 'progress',
          message: 'Updating playlist',
          details: `Updating playlist (${done}/${total})`,
          percentage: Math.round((SEARCH_PHASE_WEIGHT + (done / Math.max(total, 1)) * PLAYLIST_PHASE_WEIGHT) * 100)
        })
      );
      logApiCall('reconcile update', (reconcileResult.inserted + reconcileResult.moved + reconcileResult.deleted) * 50);
      Logger.info('UPDATE mode reconcile complete', reconcileResult);
    }
    
    Logger.requestEnd('Sync Request Completed', Date.now() - startTime);
    
    // Send completion progress update
    const youtubePlaylistUrl = `https://www.youtube.com/playlist?list=${youtubePlaylistId}`;
    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'complete',
      message: `Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!`,
      details: `Found ${searchResults.filter(r => r.found).length} out of ${searchResults.length} tracks${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}`,
      currentTrack: searchResults.length,
      totalTracks: searchResults.length,
      percentage: 100
    });

    // Close SSE connections after completion
    closeProgressConnections(playlistId, youtubeUserId);

    // Log comprehensive YouTube API quota usage summary
    Logger.info('YouTube API Quota Usage Summary', {
      totalApiCalls: apiCallCount,
      totalQuotaUsed,
      operationType: existingPlaylist ? 'UPDATE' : 'SYNC',
      playlistName: playlist.name,
      playlistId,
      tracksProcessed: searchResults.length,
      tracksLimited: tracks.length > trackLimit,
      totalTracks: tracks.length,
      videosFound: searchResults.filter(r => r.found).length,
      scraperSearches: searchResults.length,
      quotaSaved: searchResults.length * 100
    });
    
    // Generate user-friendly sync feedback with unlinked track details
    const videosFound = searchResults.filter(r => r.found).length;
    const unlinkedTracks = searchResults.filter(r => !r.found).map(r => ({
      track: r.track,
      artist: r.artist
    }));

    const syncFeedbackHtml = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-feedback.ejs'), {
      playlistId,
      isUpdate: !!existingPlaylist,
      videosFound,
      totalSearched: searchResults.length,
      isLimited: tracks.length > trackLimit,
      totalTracks: tracks.length,
      unlinkedTracks
    });
    
    // After sync completes, we know the playlist exists on YouTube
    // Generate updated button HTML for out-of-band swap
    // Button configuration for rendering in template
    const buttonText = 'Update YouTube Playlist';
    const buttonClass = 'btn-outline-success';

    Logger.info('Sync complete, fetching updated playlist details for OOB swap', {
      playlistId,
      youtubePlaylistUrl
    });

    // Fetch updated playlist details to send as OOB swap using shared service
    // This eliminates code duplication with the playlistDetails route
    const playlistDetails = await fetchPlaylistDetails(spotifyApi, youtube, playlistId, youtubePlaylistId);

    Logger.info('Sending response with OOB updates including playlist details', {
      playlistId,
      linkedCount: playlistDetails.linkedCount,
      totalTracks: playlistDetails.totalTracks
    });

    // Generate playlist details HTML using shared template
    const viewsPath = path.join(__dirname, '../../views');
    const playlistDetailsHtml = await ejs.renderFile(path.join(viewsPath, 'partials/playlist-details.ejs'), {
      playlistId: playlistDetails.playlistId,
      playlistName: playlistDetails.playlistName,
      tracks: playlistDetails.tracks,
      linkedCount: playlistDetails.linkedCount,
      totalTracks: playlistDetails.totalTracks,
      hasYoutubeConnection: true, // Sync always has YouTube connection
      hasYoutubePlaylist: playlistDetails.hasYoutubePlaylist
    });

    // Render response template with all components (properly escaped)
    const responseHtml = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-response.ejs'), {
      playlistId,
      syncFeedbackHtml, // Already rendered - use <%- %> to include as HTML
      buttonText,
      buttonClass,
      playlistName: playlist.name,
      trackCount: tracks.length,
      spotifyUrl: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`,
      youtubeUrl: youtubePlaylistUrl,
      playlistDetailsHtml // Already rendered - use <%- %> to include as HTML
    });

    res.send(responseHtml);
    
  } catch (error) {
    Logger.error('Error syncing playlist', { processingTimeMs: Date.now() - startTime }, error);

    // Send error progress update
    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'error',
      message: 'Sync failed',
      details: formatErrorDetails(error)
    });

    // Close SSE connections after error
    closeProgressConnections(playlistId, youtubeUserId);

    // Log YouTube API quota usage summary even on error
    Logger.error('YouTube API Quota Usage Summary (ERROR)', {
      totalApiCalls: apiCallCount,
      totalQuotaUsed: totalQuotaUsed,
      operationAttempted: existingPlaylist ? 'UPDATE' : 'SYNC'
    });
    
    // Check if it's a quota exceeded error
    if (error && typeof error === 'object' && 'code' in error && error.code === 403) {
      const gaxiosError = error as { errors?: Array<{ reason?: string }> };
      if (gaxiosError.errors && gaxiosError.errors.some((e) => e.reason === 'quotaExceeded')) {
        Logger.warn('YouTube API quota exceeded - returning error partial for HTMX');
        // Return error partial for HTMX instead of redirecting
        const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-error.ejs'), {
          playlistId: playlistId || 'unknown',
          title: 'YouTube Quota Exceeded',
          message: 'Your YouTube API quota has been exceeded. YouTube limits API usage per day.',
          details: 'The quota resets at midnight Pacific Time. You can continue using the app with existing playlists, but cannot sync new content until the quota resets.'
        });
        return res.status(403).send(html);
      }
    }
    
    // Check if it's an authentication error
    if (error instanceof Error && (
      error.message === 'SPOTIFY_AUTH_REQUIRED' ||
      error.message === 'YOUTUBE_AUTH_REQUIRED'
    )) {
      const service = error.message === 'SPOTIFY_AUTH_REQUIRED' ? 'Spotify' : 'YouTube';
      const loginUrl = error.message === 'SPOTIFY_AUTH_REQUIRED' ?
        '/auth/spotify/login' : '/auth/youtube/login';

      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/auth-expired.ejs'), {
        service,
        loginUrl
      });
      return res.status(401).send(html);
    }
    
    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-error.ejs'), {
      playlistId: 'unknown',
      title: 'Error syncing playlist',
      message: `Something went wrong during the sync process. Please try again. Details: ${formatErrorDetails(error)}`
    });
    res.status(500).send(html);
  }
});

export { router as syncRouter };
