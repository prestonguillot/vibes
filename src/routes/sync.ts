import { Router, Request, Response } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';
import { searchMusicVideo } from '../utils/youtubeScraper';
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
import { reorderPlaylistTracks } from '../utils/playlistReordering';
import { optimalTrackMatching, SimplifiedTrack, SimplifiedVideo } from '../utils/trackMatching';
import { formatErrorDetails } from '../utils/errorFormatter';
import { fetchPlaylistDetails } from '../services/playlistDetailsService';

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
    { batchSize?: '1' | '5' | '10' | 'all' }
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
    Logger.external('Spotify', 'Playlist details fetched', { name: playlist.name, totalTracks: playlist.tracks.total });

    sendProgressUpdate(playlistId, youtubeUserId, {
      type: 'progress',
      message: `Found playlist: "${playlist.name}"`,
      details: `Fetching tracks (limit: 10)...`
    });

    // Get batch size from request, default to 1 if not provided
    let batchSize = 1;
    if (req.body.batchSize) {
      if (req.body.batchSize === 'all') {
        // "all" means process all tracks (use playlist total)
        batchSize = playlist.tracks.total || 999;
      } else {
        batchSize = parseInt(req.body.batchSize);
      }
    }
    const trackLimit = batchSize; // Use user-selected batch size
    
    Logger.info('Using user-selected batch size', { batchSize, trackLimit });
    Logger.external('Spotify', 'Fetching all tracks for analysis');

    // Fetch all tracks (handle pagination if needed)
    let allTracks: unknown[] = [];
    let offset = 0;
    const limit = 50;

    let totalTracks = 0;
    do {
      const tracksResponse = await spotifyApi.getPlaylistTracks(playlistId, { limit, offset });
      const trackItems = tracksResponse.body.items.filter((item: unknown) => {
        const typedItem = item as { track: { type?: string } | null };
        return typedItem.track && typedItem.track.type === 'track';
      });
      allTracks = allTracks.concat(trackItems);
      offset += limit;
      totalTracks = tracksResponse.body.total;

      // Break if we've fetched all tracks
      if (tracksResponse.body.items.length < limit) break;
    } while (allTracks.length < totalTracks);
    
    const tracks = allTracks;
    Logger.info('Found valid tracks to analyze', { count: tracks.length, totalPlaylistTracks: playlist.tracks.total });

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
    
    // [REMOVED: reorderExistingTracks function - now using shared reorderPlaylistTracks from utils/playlistReordering.ts]

    // Helper function to log API calls with correct quota costs
    const logApiCall = (operation: string, quotaCost: number) => {
      apiCallCount++;
      totalQuotaUsed += quotaCost;
      Logger.external('YouTube', `API call: ${operation}`, { callNumber: apiCallCount, quotaCost, totalQuotaUsed });
    };

    // STEP 1: Check if a YouTube playlist already exists FIRST
    const playlistTitle = `${playlist.name} (from Spotify)`;
    Logger.external('YouTube', 'Checking for existing playlist before video search', { title: playlistTitle });

    let youtubePlaylistId: string = '';
    let existingVideoIds: Set<string> = new Set();
    let existingItemsMap: Map<string, youtube_v3.Schema$PlaylistItem> = new Map();
    let isUpdateMode = false;
    
    try {
      const existingPlaylists = await youtube.playlists.list({
        part: ['id', 'snippet'],
        mine: true,
        maxResults: 50
      });
      
      logApiCall('playlist search', 1);
      
      if (existingPlaylists.data.items) {
        existingPlaylist = existingPlaylists.data.items?.find(p =>
          p.snippet?.title === playlistTitle
        ) || null;
      }
      
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
    
    // STEP 2: Determine which tracks need video search based on mode
    let tracksToSearch: unknown[] = [];
    let syncedTracks: unknown[] = [];
    let unsyncedTracks: unknown[] = [];

    if (isUpdateMode) {
      // UPDATE MODE: Use track matching to identify which tracks are actually unsynced
      const existingVideoCount = existingVideoIds.size;
      
      Logger.info('UPDATE MODE: Using track matching to identify unsynced tracks', {
        totalSpotifyTracks: tracks.length,
        existingYouTubeVideos: existingVideoCount,
        trackLimit
      });
      
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'progress',
        message: `Analyzing playlist for updates`,
        details: `Found ${existingVideoCount} existing videos, matching tracks to identify unsynced ones...`,
        percentage: 5
      });
      
      // Get existing YouTube videos with details for matching
      const existingVideos: SimplifiedVideo[] = [];
      for (const item of existingItemsMap.values()) {
        if (item.snippet?.resourceId?.videoId) {
          const video: SimplifiedVideo = {
            id: item.snippet.resourceId.videoId,
            title: item.snippet!.title || 'Unknown',
            description: item.snippet!.description || ''
          };
          existingVideos.push(video);
          Logger.debug('Existing YouTube video for matching', {
            videoId: video.id,
            title: video.title
          });
        }
      }

      Logger.info('Prepared existing videos for matching', {
        existingVideosCount: existingVideos.length,
        existingVideoTitles: existingVideos.map(v => v.title).slice(0, 3) // Show first 3 titles
      });

      // Build arrays of tracks for optimal matching
      const tracksToMatch: SimplifiedTrack[] = [];
      const trackIndexMap = new Map<string, number>(); // Track ID -> index in tracks array

      Logger.info('Starting track matching analysis', {
        totalSpotifyTracks: tracks.length,
        existingYouTubeVideos: existingVideos.length
      });

      for (let i = 0; i < tracks.length; i++) {
        const item = tracks[i];
        const typedItem = item as { track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null };
        if (typedItem.track && typedItem.track.type === 'track') {
          const track = typedItem.track;
          tracksToMatch.push({
            id: track.id,
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist'
          });
          trackIndexMap.set(track.id, i);
        }
      }

      // Use optimal matching algorithm to resolve conflicts based on match quality
      const trackMatches = optimalTrackMatching(tracksToMatch, existingVideos);

      // Match Spotify tracks to existing YouTube videos to identify unsynced tracks
      // (unsyncedTracks and syncedTracks declared at higher scope)

      for (const item of tracks) {
        const typedItem = item as { track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null };
        if (typedItem.track && typedItem.track.type === 'track') {
          const track = typedItem.track;
          const spotifyTrack = {
            id: track.id,
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist'
          };

          // Check if this track was matched in the optimal matching
          const matchingVideo = trackMatches.get(track.id);

          if (!matchingVideo) {
            unsyncedTracks.push(item);
            Logger.debug('Track identified as UNSYNCED', {
              trackName: spotifyTrack.name,
              artist: spotifyTrack.artist,
              existingVideoCount: existingVideos.length
            });
          } else {
            syncedTracks.push(item);
            Logger.debug('Track identified as SYNCED', {
              trackName: spotifyTrack.name,
              artist: spotifyTrack.artist,
              matchedVideoTitle: matchingVideo.title,
              matchedVideoId: matchingVideo.id
            });
          }
        }
      }
      
      Logger.info('Track matching analysis complete', {
        totalTracks: tracks.length,
        syncedTracks: syncedTracks.length,
        unsyncedTracks: unsyncedTracks.length,
        existingVideos: existingVideos.length
      });

      // STEP 2.5: In UPDATE mode, skip pre-reordering - reorder after adding new videos
      // This ensures all positions exist before attempting moves
      if (!isUpdateMode) {
        Logger.info('CREATE mode: Reordering existing tracks before adding new videos');
        await reorderPlaylistTracks(
          youtube,
          youtubePlaylistId,
          tracks,
          syncedTracks,
          (message, details, percentage) => {
            sendProgressUpdate(playlistId, youtubeUserId, {
              type: 'progress',
              message,
              details,
              percentage
            });
          }
        );
      } else {
        Logger.info('UPDATE mode: Deferring reorder until after new videos are added');
      }
      
      // Limit to trackLimit unsynced tracks per operation
      tracksToSearch = unsyncedTracks.slice(0, trackLimit);
      
      Logger.info('UPDATE MODE: Identified unsynced tracks using matching', {
        totalUnsyncedTracks: unsyncedTracks.length,
        tracksToSearchThisOperation: tracksToSearch.length,
        trackLimit
      });
    } else {
      // CREATE MODE: Process up to trackLimit tracks from the beginning
      Logger.info('CREATE MODE: Processing up to limit tracks from beginning', {
        totalSpotifyTracks: tracks.length,
        trackLimit
      });
      tracksToSearch = tracks.slice(0, trackLimit);
    }
    
    // STEP 3: Search for YouTube videos
    const videoIds: string[] = [];
    const searchResults: Array<{track: string, artist: string, found: boolean, videoId?: string, spotifyPosition: number, spotifyTrackId: string}> = [];
    let searchCount = 0;
    
    const searchMessage = isUpdateMode ? 'Checking for playlist updates' : 'Finding music videos';
    Logger.info(`Starting video search: ${searchMessage}`, { tracksToSearch: tracksToSearch.length });
    
    for (let i = 0; i < tracksToSearch.length; i++) {
      const item = tracksToSearch[i];
      const typedItem = item as { track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null };
      if (typedItem.track && typedItem.track.type === 'track') {
        const track = typedItem.track;
        const artist = track.artists[0]?.name || 'Unknown Artist';
        const songName = track.name;
        
        // Calculate the original Spotify position
        const spotifyPosition = isUpdateMode ?
          existingVideoIds.size + i : // Update mode: position after existing items
          i; // Create mode: position from beginning
        
        try {
          Logger.debug('Searching for track', { trackNumber: searchCount + 1, totalTracks: tracksToSearch.length, artist, songName });
          
          // Send progress update with current song info (search phase: 0-70% of total)
          const searchProgress = (searchCount / tracksToSearch.length) * SEARCH_PHASE_WEIGHT;
          const totalPercentage = Math.round(searchProgress * 100);
          
          const progressMessage = isUpdateMode ? 'Checking for playlist updates' : 'Finding music videos';
          const progressDetails = isUpdateMode ? 
            `Analyzing "${songName}" by ${artist}... (${searchCount + 1}/${tracksToSearch.length})` :
            `Searching for "${songName}" by ${artist}... (${searchCount + 1}/${tracksToSearch.length})`;
          
          sendProgressUpdate(playlistId, youtubeUserId, {
            type: 'progress',
            message: progressMessage,
            details: progressDetails,
            currentTrack: searchCount + 1,
            totalTracks: tracksToSearch.length,
            currentSong: songName,
            currentArtist: artist,
            percentage: totalPercentage
          });
          
          const videoId = await searchMusicVideo(artist, songName);
          searchCount++;
          
          if (videoId) {
            videoIds.push(videoId);
            searchResults.push({
              track: songName,
              artist: artist,
              found: true,
              videoId: videoId,
              spotifyPosition: spotifyPosition,
              spotifyTrackId: track.id
            });
            Logger.info('Found video for track', { songName, artist, videoId, spotifyPosition });
          } else {
            searchResults.push({
              track: songName,
              artist: artist,
              found: false,
              spotifyPosition: spotifyPosition,
              spotifyTrackId: track.id
            });
            Logger.warn('No video found for track', { songName, artist, spotifyPosition });
          }
          
          // Rate limiting: add delay between searches to be respectful
          if (searchCount < tracks.length) {
            Logger.debug('Rate limiting delay', { delayMs: 100 });
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
        } catch (error) {
          searchCount++;
          Logger.error('Error searching for track', { artist, songName }, error);
          sendProgressUpdate(playlistId, youtubeUserId, {
            type: 'error',
            message: 'Error searching for video',
            details: formatErrorDetails(error)
          });
          searchResults.push({
            track: songName,
            artist: artist,
            found: false,
            spotifyPosition: spotifyPosition,
            spotifyTrackId: track.id
          });
        }
      }
    }
    
    Logger.info('Scraping completed', { searchesMade: searchCount, videosFound: videoIds.length, quotaSaved: searchCount * 100 });
    
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
          trackCount: playlist.tracks.total,
          spotifyUrl: playlist.external_urls.spotify,
          youtubeUrl: youtubePlaylistUrl
        })
      );
    }

    // Only create playlist if we found some videos (for new playlists)
    if (videoIds.length === 0) {
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
      const playlistResponse = await youtube.playlists.insert({
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
      });
      
      logApiCall('playlist creation', 50); // playlists.insert costs 50 units
      
      youtubePlaylistId = playlistResponse.data.id!;
      Logger.external('YouTube', 'Created new playlist', { title: playlistTitle, id: youtubePlaylistId });
      sendProgressUpdate(playlistId, youtubeUserId, {
        type: 'progress',
        message: `Created playlist: "${playlistTitle}"`,
        details: 'Adding videos to new playlist...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
      
      // Add all videos to the new playlist in correct order
      // Sort search results by Spotify position to maintain order
      const foundResults = searchResults.filter(result => result.found && result.videoId);
      foundResults.sort((a, b) => a.spotifyPosition - b.spotifyPosition);
      
      for (let i = 0; i < foundResults.length; i++) {
        const result = foundResults[i];
        const videoId = result.videoId!;
        
        try {
          // YouTube API doesn't support position on insert, videos are added to the end
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: videoId,
                }
              }
            }
          });
          logApiCall('add video to new playlist', 50); // playlistItems.insert costs 50 units
          Logger.external('YouTube', 'Added video to new playlist', { videoId, position: result.spotifyPosition });
          const currentIndex = i + 1;
          // Calculate total progress: 70% (search complete) + 30% * (current/total) for playlist phase
          const playlistProgress = (currentIndex / foundResults.length) * PLAYLIST_PHASE_WEIGHT;
          const totalPercentage = Math.round((SEARCH_PHASE_WEIGHT + playlistProgress) * 100);
          
          // Use the result we already have
          const songName = result.track;
          const artistName = result.artist;
          
          sendProgressUpdate(playlistId, youtubeUserId, {
            type: 'progress',
            message: `Adding videos to playlist`,
            details: `Adding "${songName}" by ${artistName} (${currentIndex}/${foundResults.length})`,
            currentTrack: currentIndex,
            totalTracks: foundResults.length,
            currentSong: songName,
            currentArtist: artistName,
            percentage: totalPercentage
          });
        } catch (error) {
          Logger.error('Error adding video to playlist', { videoId }, error);
          sendProgressUpdate(playlistId, youtubeUserId, {
            type: 'error',
            message: 'Error adding video to playlist',
            details: formatErrorDetails(error)
          });
        }
      }
      
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
      
      // Add all videos found (these are only for the next unsynced tracks) in correct order
      const foundResults = searchResults.filter(result => result.found && result.videoId);
      foundResults.sort((a, b) => a.spotifyPosition - b.spotifyPosition);
      
      let addedCount = 0;
      const totalToAdd = foundResults.length;
      
      if (totalToAdd > 0) {
        Logger.info('Adding new videos from next unsynced tracks', { count: totalToAdd });
        
        for (const result of foundResults) {
          const videoId = result.videoId!;
          
          try {
            // YouTube API doesn't support position on insert, videos are added to the end
            await youtube.playlistItems.insert({
              part: ['snippet'],
              requestBody: {
                snippet: {
                  playlistId: youtubePlaylistId,
                  resourceId: {
                    kind: 'youtube#video',
                    videoId: videoId,
                  }
                }
              }
            });
            logApiCall('add new video', 50); // playlistItems.insert costs 50 units
            addedCount++;
            Logger.external('YouTube', 'Added new video to playlist', { videoId, position: result.spotifyPosition });
            
            // Use the result we already have
            const songName = result.track;
            const artistName = result.artist;
            
            // Update progress
            const playlistProgress = (addedCount / Math.max(totalToAdd, 1)) * PLAYLIST_PHASE_WEIGHT;
            const totalPercentage = Math.round((SEARCH_PHASE_WEIGHT + playlistProgress) * 100);
            
            sendProgressUpdate(playlistId, youtubeUserId, {
              type: 'progress',
              message: `Adding new tracks`,
              details: `Added "${songName}" by ${artistName} (${addedCount}/${totalToAdd})`,
              currentTrack: addedCount,
              totalTracks: totalToAdd,
              currentSong: songName,
              currentArtist: artistName,
              percentage: totalPercentage
            });
          } catch (error) {
            Logger.error('Error adding new video to playlist', { videoId }, error);
            sendProgressUpdate(playlistId, youtubeUserId, {
              type: 'error',
              message: 'Error adding video to playlist',
              details: formatErrorDetails(error)
            });
          }
        }
      }

      // Step 3: Reorder all synced tracks to match Spotify order (UPDATE mode only)
      // This ensures that order changes in Spotify are reflected in YouTube, even if no new videos were added
      if (isUpdateMode) {
        // If we just added new videos, wait a moment for YouTube to process the changes
        // This prevents race conditions where we fetch the playlist before additions are fully propagated
        if (addedCount > 0) {
          Logger.info('Waiting for YouTube to process newly added tracks before reordering', {
            addedCount,
            waitTime: 2000
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        // Create a complete list of ALL synced tracks (existing + newly added)
        const allSyncedTracks = [...syncedTracks];

        // Add the newly added tracks to the list
        if (addedCount > 0) {
          for (const result of foundResults) {
            if (result.found && result.videoId) {
              allSyncedTracks.push({
                track: {
                  id: result.spotifyTrackId,
                  name: result.track,
                  artists: [{ name: result.artist }]
                },
                matchedVideoId: result.videoId
              });
            }
          }
        }

        Logger.info('UPDATE mode: Reordering all tracks to match current Spotify order', {
          existingSyncedTracks: syncedTracks.length,
          newVideosAdded: addedCount,
          totalTracksToReorder: allSyncedTracks.length
        });

        sendProgressUpdate(playlistId, youtubeUserId, {
          type: 'progress',
          message: `Finalizing playlist order`,
          details: 'Ensuring track order matches Spotify...',
          percentage: 95
        });

        // Reorder ALL synced tracks (including newly added ones) to match current Spotify positions
        await reorderPlaylistTracks(
          youtube,
          youtubePlaylistId,
          tracks,
          allSyncedTracks,
          (message, details, percentage) => {
            sendProgressUpdate(playlistId, youtubeUserId, {
              type: 'progress',
              message,
              details,
              percentage
            });
          }
        );
      } else if (isUpdateMode) {
        Logger.info('UPDATE mode: No synced tracks to reorder');
      } else {
        Logger.info('CREATE mode: Reordering already happened before adding videos');
      }
      
      Logger.info('Update completed', {
        videosAdded: addedCount,
        totalVideosToAdd: totalToAdd
      });
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
      spotifyUrl: playlist.external_urls.spotify,
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
        Logger.warn('YouTube API quota exceeded - sync stopped gracefully');
        const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-error.ejs'), {
          playlistId: 'unknown',
          title: 'YouTube API Quota Exceeded',
          message: 'You\'ve reached the daily YouTube API quota limit. Please try again tomorrow when the quota resets.'
        });
        return res.status(429).send(html);
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
