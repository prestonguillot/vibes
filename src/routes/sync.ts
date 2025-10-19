import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import SpotifyWebApi from 'spotify-web-api-node';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { searchMusicVideo } from '../utils/youtubeScraper';
import { sendProgressUpdate, closeProgressConnections } from './progress';
import { Logger } from '../utils/logger';
import { getSecureCookieOptions } from '../utils/authValidation';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { csrfValidationMiddleware } from '../utils/csrf';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';

// Internal types for sync operations
interface SimplifiedTrack {
  id: string;
  name: string;
  artist: string;
}

interface SimplifiedVideo {
  id: string;
  title: string;
  description: string;
  playlistItemId?: string;
}

const router = Router();

// Rate limiter for sync operations
// Sync is resource-intensive (YouTube scraping, API calls, playlist operations)
// Limit to 5 sync operations per 5 minutes per IP
const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // Limit each IP to 5 requests per window
  message: 'Too many sync requests from this IP, please try again in a few minutes',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  // Custom handler for rate limit exceeded
  handler: async (req, res) => {
    Logger.warn('Sync rate limit exceeded', {
      ip: req.ip,
      url: req.originalUrl,
      method: req.method
    });

    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'warning',
      title: 'Too Many Sync Requests',
      message: 'You\'ve made too many sync requests in a short period.',
      details: 'Please wait a few minutes before trying again. This limit helps prevent abuse and ensures the service remains available for everyone.'
    });

    res.status(429).send(html);
  }
});

// Track matching functions (from playlist details)
function findBestMatch(spotifyTrack: SimplifiedTrack, youtubeVideos: SimplifiedVideo[]): SimplifiedVideo | null {
  let bestMatch = null;
  let bestScore = 0;
  const minScore = 0.4; // Minimum similarity threshold
  
  for (const video of youtubeVideos) {
    const score = calculateMatchScore(spotifyTrack, video);
    if (score > bestScore && score >= minScore) {
      bestScore = score;
      bestMatch = video;
    }
  }
  
  return bestMatch;
}

function calculateMatchScore(spotifyTrack: SimplifiedTrack, youtubeVideo: SimplifiedVideo): number {
  // Extract core titles by removing metadata
  const coreTrackName = extractCoreTitle(spotifyTrack.name);
  const coreArtistName = normalizeText(spotifyTrack.artist);
  const coreVideoTitle = extractCoreTitle(youtubeVideo.title);
  
  let score = 0;
  
  // Strategy 1: Core track title exact match (highest priority)
  if (coreVideoTitle.includes(coreTrackName) || coreTrackName.includes(coreVideoTitle)) {
    score += 0.8;
    
    // Bonus if artist also matches
    if (coreVideoTitle.includes(coreArtistName) || youtubeVideo.title.toLowerCase().includes(coreArtistName)) {
      score += 0.15;
    }
  }
  
  // Strategy 2: Fuzzy core title matching (handles minor variations)
  const titleSimilarity = calculateStringSimilarity(coreTrackName, coreVideoTitle);
  if (titleSimilarity > 0.8) {
    score += 0.7 * titleSimilarity;
    
    // Bonus if artist matches
    if (coreVideoTitle.includes(coreArtistName) || youtubeVideo.title.toLowerCase().includes(coreArtistName)) {
      score += 0.2;
    }
  }
  
  // Strategy 3: Word-by-word core matching
  const trackCoreWords = coreTrackName.split(' ').filter(w => w.length > 2);
  const videoCoreWords = coreVideoTitle.split(' ').filter(w => w.length > 2);
  
  if (trackCoreWords.length > 0) {
    const coreWordMatches = trackCoreWords.filter(word => 
      videoCoreWords.some(vw => 
        vw === word || vw.includes(word) || word.includes(vw) ||
        calculateStringSimilarity(word, vw) > 0.85
      )
    ).length;
    
    const coreMatchRatio = coreWordMatches / trackCoreWords.length;
    if (coreMatchRatio > 0.5) {
      score += 0.5 * coreMatchRatio;
    }
  }
  
  // Strategy 4: Artist name matching (secondary)
  const videoTitle = normalizeText(youtubeVideo.title);
  if (videoTitle.includes(coreArtistName)) {
    score += 0.2;
  }
  
  return Math.min(score, 1.0);
}

function extractCoreTitle(title: string): string {
  let coreTitle = normalizeText(title);
  
  // Remove everything after common metadata indicators
  const metadataPatterns = [
    /\s*-\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*$/i,
    /\s*\(\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*\).*$/i,
    /\s*\[\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*\].*$/i,
    /\s*-\s*\d{4}.*$/i, // Remove "- 2016 Remaster" etc.
    /\s*\(\s*\d{4}.*\).*$/i, // Remove "(2016 Remaster)" etc.
    /\s*\[\s*\d{4}.*\].*$/i, // Remove "[2016 Remaster]" etc.
    /\s*\(\s*with\s+.*?\).*$/i, // Remove "(with Artist)" 
    /\s*\(\s*feat\.?\s+.*?\).*$/i, // Remove "(feat. Artist)"
    /\s*-\s*live\s+at.*$/i, // Remove "- Live at Venue"
    /\s*\(\s*live\s+at.*\).*$/i, // Remove "(Live at Venue)"
    /\s*,\s*pt\.?\s*\d+.*$/i, // Keep "Pt. 2" but remove metadata after it
  ];
  
  for (const pattern of metadataPatterns) {
    coreTitle = coreTitle.replace(pattern, '').trim();
  }
  
  // Special handling for "Pt." - keep it but remove what comes after
  coreTitle = coreTitle.replace(/(\s*,?\s*pt\.?\s*\d+).*$/i, '$1');
  
  // Clean up any remaining artifacts
  coreTitle = coreTitle
    .replace(/\s*-\s*$/, '') // Remove trailing dashes
    .replace(/\s*,\s*$/, '') // Remove trailing commas
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
  
  return coreTitle;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/\b(official|video|audio|live|remix|version|ft|feat|featuring)\b/g, '') // Remove common extra words
    .trim();
}

function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = calculateLevenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function calculateLevenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Optimal track-to-video matching algorithm
 *
 * Resolves conflicts by assigning videos to tracks based on match quality,
 * not processing order. If multiple tracks want the same video, the video
 * goes to the track with the highest match score.
 *
 * Algorithm:
 * 1. Calculate all match scores for all track-video pairs
 * 2. Sort pairs by score (highest first)
 * 3. Greedily assign: give each video to the track with the best match
 * 4. Skip tracks/videos that are already assigned
 *
 * @param tracks Array of Spotify tracks to match
 * @param videos Array of YouTube videos to match against
 * @returns Map of track ID -> matched video (only includes successful matches)
 */
function optimalTrackMatching(
  tracks: SimplifiedTrack[],
  videos: SimplifiedVideo[]
): Map<string, SimplifiedVideo> {
  const minScore = 0.4; // Minimum similarity threshold

  // Step 1: Calculate all match scores
  interface MatchCandidate {
    track: SimplifiedTrack;
    video: SimplifiedVideo;
    score: number;
  }

  const candidates: MatchCandidate[] = [];

  for (const track of tracks) {
    for (const video of videos) {
      const score = calculateMatchScore(track, video);
      if (score >= minScore) {
        candidates.push({ track, video, score });
      }
    }
  }

  // Step 2: Sort by score (highest first)
  candidates.sort((a, b) => b.score - a.score);

  // Step 3: Greedy assignment - assign best matches first
  const assignedTracks = new Set<string>();
  const assignedVideos = new Set<string>();
  const matches = new Map<string, SimplifiedVideo>();

  for (const candidate of candidates) {
    // Skip if this track or video is already assigned
    if (assignedTracks.has(candidate.track.id) || assignedVideos.has(candidate.video.id)) {
      continue;
    }

    // Assign this match
    matches.set(candidate.track.id, candidate.video);
    assignedTracks.add(candidate.track.id);
    assignedVideos.add(candidate.video.id);
  }

  Logger.debug('Optimal matching results', {
    totalTracks: tracks.length,
    totalVideos: videos.length,
    candidatesEvaluated: candidates.length,
    successfulMatches: matches.size,
    unmatchedTracks: tracks.length - matches.size
  });

  return matches;
}

// Helper functions for token refresh
const ensureValidSpotifyToken = async (req: Request, res: Response): Promise<SpotifyWebApi> => {
  const spotifyTokens: SpotifyTokens | null = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;

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

        // Update cookie with new token
        const updatedTokens = { ...spotifyTokens, accessToken: access_token };
        res.cookie('spotify_tokens', JSON.stringify(updatedTokens), getSecureCookieOptions());
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

// Helper function to ensure valid YouTube token and return quota usage
async function ensureValidYouTubeToken(req: Request, res: Response): Promise<{ oauth2Client: OAuth2Client, quotaUsed: number }> {
  const youtubeTokens: YouTubeTokens | null = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;

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

        // Update cookie with new tokens
        const updatedTokens = {
          ...youtubeTokens,
          ...credentials
        };
        res.cookie('youtube_tokens', JSON.stringify(updatedTokens), getSecureCookieOptions());
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

// Conditionally apply rate limiting middleware based on environment variable
const rateLimitingEnabled = process.env.ENABLE_RATE_LIMITING === 'true';
const syncMiddleware = rateLimitingEnabled ? [syncLimiter, csrfValidationMiddleware] : [csrfValidationMiddleware];

Logger.info('Sync rate limiting configuration', { enabled: rateLimitingEnabled });

router.post('/playlist/:playlistId',
  ...syncMiddleware, // Conditionally apply rate limiting (default: OFF)
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

  // Send initial progress update
  sendProgressUpdate(playlistId, {
    type: 'progress',
    message: 'Starting sync...',
    details: 'Checking authentication and initializing APIs'
  });

  // Declare variables outside try block so they're accessible in catch
  let apiCallCount = 0;
  let totalQuotaUsed = 0;
  let existingPlaylist: youtube_v3.Schema$Playlist | null = null;

  try {
    // Check authentication
    const spotifyTokens: SpotifyTokens | null = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;
    const youtubeTokens: YouTubeTokens | null = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;

    if (!spotifyTokens) {
      Logger.error('No Spotify tokens in cookies');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'Authentication required',
        details: 'Please connect to Spotify first'
      });
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'Spotify Authentication Required',
        message: 'Please connect to Spotify first',
        details: 'Use the Spotify connection button at the top of the page to authenticate.'
      });
      return res.status(401).send(html);
    }

    if (!youtubeTokens) {
      Logger.error('No YouTube tokens in cookies');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'Authentication required',
        details: 'Please connect to YouTube first'
      });
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'YouTube Authentication Required',
        message: 'Please connect to YouTube first',
        details: 'Use the YouTube connection button at the top of the page to authenticate.'
      });
      return res.status(401).send(html);
    }

    Logger.info('Authentication check passed');

    sendProgressUpdate(playlistId, {
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

    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: 'APIs initialized',
      details: 'Fetching Spotify playlist details...'
    });

    // Get playlist details
    Logger.external('Spotify', 'Fetching playlist details');
    const playlistResponse = await spotifyApi.getPlaylist(playlistId);
    const playlist = playlistResponse.body;
    Logger.external('Spotify', 'Playlist details fetched', { name: playlist.name, totalTracks: playlist.tracks.total });

    sendProgressUpdate(playlistId, {
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

    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: `Processing ${tracks.length} tracks`,
      details: 'Searching for existing YouTube playlist...',
      currentTrack: 0,
      totalTracks: tracks.length
    });

    if (tracks.length === 0) {
      Logger.warn('No tracks to sync');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'No tracks found',
        details: 'No tracks found in the playlist'
      });
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'No Tracks Found',
        message: 'No tracks found to sync',
        details: 'This playlist appears to be empty or contains only unplayable tracks.'
      });
      return res.send(html);
    }

    // Calculate total progress phases: search (70%) + playlist operations (30%)
    const SEARCH_PHASE_WEIGHT = 0.7;
    const PLAYLIST_PHASE_WEIGHT = 0.3;
    
    // Reorder existing YouTube playlist tracks to match current Spotify playlist order
    const reorderExistingTracks = async (
      youtube: youtube_v3.Youtube,
      youtubePlaylistId: string,
      spotifyTracks: unknown[],
      syncedTracks: unknown[],
      existingItemsMap: Map<string, youtube_v3.Schema$PlaylistItem>,
      playlistId: string
    ) => {
      if (syncedTracks.length === 0) {
        Logger.info('No existing synced tracks to reorder');
        return;
      }

      Logger.info('Starting playlist reordering', { 
        syncedTracksCount: syncedTracks.length,
        totalSpotifyTracks: spotifyTracks.length 
      });

      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: 'Reordering existing tracks',
        details: `Organizing ${syncedTracks.length} existing tracks to match Spotify order...`,
        percentage: 15
      });

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
        logApiCall('get current playlist order', 1);

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
      const tracksToMatch: SimplifiedTrack[] = [];
      for (const syncedTrack of syncedTracks) {
        const typedSyncedTrack = syncedTrack as { track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null };
        if (typedSyncedTrack.track && typedSyncedTrack.track.type === 'track') {
          const track = typedSyncedTrack.track;
          tracksToMatch.push({
            id: track.id,
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist'
          });
        }
      }

      // Use optimal matching algorithm to resolve conflicts based on match quality
      const trackMatches = optimalTrackMatching(tracksToMatch, existingVideos);

      // Find existing YouTube videos that need reordering (only those in wrong positions)
      const reorderOperations = [];

      for (const syncedTrack of syncedTracks) {
        const typedSyncedTrack = syncedTrack as { track: { id: string; name: string; artists: Array<{ name?: string }>; type?: string } | null };
        if (typedSyncedTrack.track && typedSyncedTrack.track.type === 'track') {
          const track = typedSyncedTrack.track;
          const trackKey = `${track.name.toLowerCase()}-${track.artists[0]?.name?.toLowerCase() || ''}`;
          const targetPosition = spotifyTrackPositions.get(trackKey);

          if (targetPosition !== undefined) {
            // Get the matched video from optimal matching
            const matchingVideo = trackMatches.get(track.id);

            if (matchingVideo && matchingVideo.playlistItemId) {
              const currentPosInfo = currentPositions.get(matchingVideo.id);

              // CRITICAL FIX: Only add to reorder operations if position is actually wrong
              if (currentPosInfo && currentPosInfo.currentPosition !== targetPosition) {
                reorderOperations.push({
                  playlistItemId: matchingVideo.playlistItemId,
                  videoId: matchingVideo.id,
                  currentPosition: currentPosInfo.currentPosition,
                  targetPosition: targetPosition,
                  trackName: track.name,
                  artist: track.artists[0]?.name || 'Unknown Artist'
                });

                Logger.info('Track needs repositioning', {
                  trackName: track.name,
                  artist: track.artists[0]?.name || 'Unknown Artist',
                  currentPosition: currentPosInfo.currentPosition,
                  targetPosition: targetPosition,
                  videoId: matchingVideo.id,
                  videoTitle: matchingVideo.title
                });
              } else if (currentPosInfo) {
                Logger.info('Track already in correct position, skipping', {
                  trackName: track.name,
                  artist: track.artists[0]?.name || 'Unknown Artist',
                  position: targetPosition,
                  currentPosition: currentPosInfo.currentPosition,
                  videoId: matchingVideo.id,
                  videoTitle: matchingVideo.title
                });
              } else {
                Logger.warn('Could not find current position for matched video', {
                  trackName: track.name,
                  artist: track.artists[0]?.name || 'Unknown Artist',
                  targetPosition,
                  videoId: matchingVideo.id,
                  videoTitle: matchingVideo.title
                });
              }
            }
          }
        }
      }

      Logger.info('Identified tracks for reordering', { 
        reorderOperationsCount: reorderOperations.length,
        totalSyncedTracks: syncedTracks.length,
        tracksAlreadyInCorrectPosition: syncedTracks.length - reorderOperations.length
      });

      // If no tracks need reordering, skip the entire reordering phase
      if (reorderOperations.length === 0) {
        Logger.info('All tracks already in correct positions - skipping reordering phase');
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: 'Playlist order verified',
          details: `All ${syncedTracks.length} existing tracks are already in correct positions`,
          percentage: 25
        });
        return;
      }

      // Sort reorder operations by target position to maintain order
      reorderOperations.sort((a, b) => a.targetPosition - b.targetPosition);

      // Execute reorder operations using delete + insert strategy
      // YouTube's API has issues with position updates, so we delete and re-insert instead
      let reorderedCount = 0;
      for (const operation of reorderOperations) {
        try {
          // Step 1: Delete the item from its current position
          await youtube.playlistItems.delete({
            id: operation.playlistItemId
          });
          logApiCall('delete for reorder', 50); // playlistItems.delete costs 50 units

          // Step 2: Insert it at the target position
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                position: operation.targetPosition,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: operation.videoId,
                }
              }
            }
          });
          logApiCall('insert for reorder', 50); // playlistItems.insert costs 50 units

          reorderedCount++;
          Logger.external('YouTube', 'Reordered track position', {
            trackName: operation.trackName,
            artist: operation.artist,
            fromPosition: operation.currentPosition,
            toPosition: operation.targetPosition,
            videoId: operation.videoId
          });

          // Update progress
          const reorderProgress = (reorderedCount / reorderOperations.length) * 0.1; // 10% of total progress for reordering
          const totalPercentage = Math.round((0.15 + reorderProgress) * 100);

          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: 'Reordering existing tracks',
            details: `Moved "${operation.trackName}" from position ${operation.currentPosition + 1} to ${operation.targetPosition + 1} (${reorderedCount}/${reorderOperations.length})`,
            percentage: totalPercentage
          });

          // Rate limiting - slightly longer delay for two API calls
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
          Logger.error('Error reordering track', {
            trackName: operation.trackName,
            currentPosition: operation.currentPosition,
            targetPosition: operation.targetPosition,
            videoId: operation.videoId
          }, error);

          // In UPDATE mode, throw error to stop sync - we need atomic operations
          if (typeof isUpdateMode !== 'undefined' && isUpdateMode) {
            throw new Error(`Failed to reorder track "${operation.trackName}" from position ${operation.currentPosition} to ${operation.targetPosition}. Please try again.`);
          }
          // In CREATE mode, continue with next operation
        }
      }

      Logger.info('Playlist reordering complete', { 
        reorderedCount,
        totalOperations: reorderOperations.length 
      });
    };
    
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
    
    if (isUpdateMode) {
      // UPDATE MODE: Use track matching to identify which tracks are actually unsynced
      const existingVideoCount = existingVideoIds.size;
      
      Logger.info('UPDATE MODE: Using track matching to identify unsynced tracks', {
        totalSpotifyTracks: tracks.length,
        existingYouTubeVideos: existingVideoCount,
        trackLimit
      });
      
      sendProgressUpdate(playlistId, {
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
      const unsyncedTracks: unknown[] = [];
      const syncedTracks: unknown[] = [];

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
        await reorderExistingTracks(youtube, youtubePlaylistId, tracks, syncedTracks, existingItemsMap, playlistId);
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
    const searchResults: Array<{track: string, artist: string, found: boolean, videoId?: string, spotifyPosition: number}> = [];
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
          
          sendProgressUpdate(playlistId, {
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
              spotifyPosition: spotifyPosition
            });
            Logger.info('Found video for track', { songName, artist, videoId, spotifyPosition });
          } else {
            searchResults.push({
              track: songName,
              artist: artist,
              found: false,
              spotifyPosition: spotifyPosition
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
          sendProgressUpdate(playlistId, {
            type: 'error',
            message: 'Error searching for video',
            details: error instanceof Error ? error.message : 'An unexpected error occurred'
          });
          searchResults.push({
            track: songName,
            artist: artist,
            found: false,
            spotifyPosition: spotifyPosition
          });
        }
      }
    }
    
    Logger.info('Scraping completed', { searchesMade: searchCount, videosFound: videoIds.length, quotaSaved: searchCount * 100 });
    
    // After search phase completes, we're at 70% progress
    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: `Found ${videoIds.length} music videos`,
      details: 'Checking for existing YouTube playlist...',
      percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
    });
    
    // STEP 4: Create or update YouTube playlist
    if (isUpdateMode) {
      // UPDATE MODE: Update existing playlist
      Logger.external('YouTube', 'Updating existing playlist', { title: playlistTitle, id: youtubePlaylistId });
      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: `Updating existing playlist: "${playlistTitle}"`,
        details: 'Processing playlist updates...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
    } else {
      // CREATE MODE: Create new playlist
      Logger.external('YouTube', 'Creating new playlist', { title: playlistTitle });
      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: `Creating new YouTube playlist`,
        details: 'Setting up new playlist...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
    }
    
    // Only create playlist if we found some videos
    if (videoIds.length === 0) {
      Logger.warn('No videos found');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'No videos found',
        details: 'No videos found in the playlist'
      });
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'No videos found',
        message: 'Could not find any YouTube videos for the tracks in this playlist.',
        details: `API calls made: ${apiCallCount} (${totalQuotaUsed} quota units)`
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
      sendProgressUpdate(playlistId, {
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
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                position: result.spotifyPosition, // Insert at correct position
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
          
          sendProgressUpdate(playlistId, {
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
          sendProgressUpdate(playlistId, {
            type: 'error',
            message: 'Error adding video to playlist',
            details: error instanceof Error ? error.message : 'An unexpected error occurred'
          });
        }
      }
      
    } else {
      // UPDATE MODE: Add the videos found for next unsynced tracks
      Logger.info('UPDATE MODE: Adding videos for next unsynced tracks');
      
      Logger.info('UPDATE MODE: Video analysis for next tracks', {
        videosFoundForNextTracks: videoIds.length
      });
      
      sendProgressUpdate(playlistId, {
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
            await youtube.playlistItems.insert({
              part: ['snippet'],
              requestBody: {
                snippet: {
                  playlistId: youtubePlaylistId,
                  position: result.spotifyPosition, // Insert at correct position
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
            
            sendProgressUpdate(playlistId, {
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
            sendProgressUpdate(playlistId, {
              type: 'error',
              message: 'Error adding video to playlist',
              details: error instanceof Error ? error.message : 'An unexpected error occurred'
            });
          }
        }
      }
      
      // Step 3: Reorder playlist to match Spotify order (for UPDATE mode after adding videos)
      if (isUpdateMode && totalToAdd > 0) {
        Logger.info('UPDATE mode: Reordering playlist to match Spotify order after adding new videos');

        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: `Finalizing playlist order`,
          details: 'Ensuring track order matches Spotify...',
          percentage: 95
        });

        // Now reorder all existing tracks to match Spotify order
        // All videos should exist now since we just added new ones
        await reorderExistingTracks(youtube, youtubePlaylistId, tracks, syncedTracks, existingItemsMap, playlistId);
      } else if (totalToAdd === 0) {
        Logger.info('No changes needed - playlist is already in sync');
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
    sendProgressUpdate(playlistId, {
      type: 'complete',
      message: `Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!`,
      details: `Found ${searchResults.filter(r => r.found).length} out of ${searchResults.length} tracks${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}`,
      currentTrack: searchResults.length,
      totalTracks: searchResults.length,
      percentage: 100
    });

    // Close SSE connections after completion
    closeProgressConnections(playlistId);

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
    const buttonText = 'Update YouTube Playlist';
    const buttonClass = 'btn-outline-success';

    const updatedButtonHtml = `<button class="btn ${buttonClass} sync-btn"
              id="sync-btn-${playlistId}"
              hx-post="/api/sync/playlist/${playlistId}"
              hx-target="#sync-result-${playlistId}"
              hx-swap="innerHTML"
              hx-indicator="#loading"
              hx-include="#syncBatchSize"
              hx-disabled-elt=".sync-btn"
              hx-swap-oob="true"
              data-playlist-name="${playlist.name}"
              data-playlist-id="${playlistId}"
              data-track-count="${tracks.length}">
        ${buttonText}
      </button>`;

    // Generate YouTube link HTML for out-of-band swap (reuse youtubePlaylistUrl from line 1356)
    const youtubeLinkHtml = `<div class="playlist-links" id="playlist-links-${playlistId}" hx-swap-oob="true">
        <a href="${playlist.external_urls.spotify}" target="_blank"
           class="playlist-link playlist-link--spotify"
           title="Open in Spotify">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="me-1">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Spotify
        </a>
        <a href="${youtubePlaylistUrl}" target="_blank"
           class="playlist-link playlist-link--youtube"
           title="Open in YouTube">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="me-1">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
          YouTube
        </a>
      </div>`;

    Logger.info('Sync complete, fetching updated playlist details for OOB swap', {
      playlistId,
      youtubePlaylistUrl
    });

    // Fetch updated playlist details to send as OOB swap
    // This is the HTMX way - server does all the work and sends complete HTML
    const updatedPlaylist = await spotifyApi.getPlaylist(playlistId);
    const updatedSpotifyTracks = updatedPlaylist.body.tracks.items
      .filter((item: unknown) => {
        const typedItem = item as { track: unknown | null };
        return typedItem.track !== null;
      })
      .map((item: unknown) => {
        const typedItem = item as { track: { id: string; name: string; artists: Array<{ name?: string }>; album?: { name?: string }; duration_ms: number; external_urls: { spotify: string }; preview_url?: string | null } };
        return {
          id: typedItem.track.id,
          name: typedItem.track.name,
          artist: typedItem.track.artists[0]?.name || 'Unknown Artist',
          album: typedItem.track.album?.name || 'Unknown Album'
        };
      });

    // Get updated YouTube videos
    const updatedYoutubeVideos: SimplifiedVideo[] = [];
    let nextPageToken: string | undefined = undefined;
    do {
      const response: youtube_v3.Schema$PlaylistItemListResponse = await youtube.playlistItems.list({
        part: ['id', 'snippet'],
        playlistId: youtubePlaylistId,
        maxResults: 50,
        pageToken: nextPageToken
      }).then(res => res.data);

      if (response.items) {
        for (const item of response.items) {
          if (item.snippet?.resourceId?.videoId) {
            updatedYoutubeVideos.push({
              id: item.snippet.resourceId.videoId,
              title: item.snippet.title || 'Unknown',
              description: item.snippet.description || ''
            });
          }
        }
      }
      nextPageToken = response.nextPageToken || undefined;
    } while (nextPageToken);

    // Match tracks to videos
    const updatedMatches = optimalTrackMatching(updatedSpotifyTracks, updatedYoutubeVideos);
    const linkedCount = updatedMatches.size;

    // Transform tracks into MergedTrack format for template
    const mergedTracks = updatedSpotifyTracks.slice(0, 10).map((track: any) => {
      const matchedVideo = updatedMatches.get(track.id);
      return {
        spotify: {
          id: track.id,
          name: track.name,
          artist: track.artist,
          album: track.album
        },
        youtube: matchedVideo ? {
          id: matchedVideo.id,
          title: matchedVideo.title,
          thumbnail: `https://img.youtube.com/vi/${matchedVideo.id}/default.jpg`,
          url: `https://www.youtube.com/watch?v=${matchedVideo.id}`
        } : null,
        linked: !!matchedVideo
      };
    });

    // Generate playlist details HTML using shared template
    const viewsPath = path.join(__dirname, '../../views');
    const playlistDetailsHtml = await ejs.renderFile(path.join(viewsPath, 'partials/playlist-details.ejs'), {
      playlistId,
      playlistName: playlist.name,
      tracks: mergedTracks,
      linkedCount,
      totalTracks: updatedSpotifyTracks.length,
      hasYoutubeConnection: true, // Sync always has YouTube connection
      hasYoutubePlaylist: true // After sync, YouTube playlist exists
    });

    // Use innerHTML swap strategy to replace content while keeping the container's attributes
    const playlistDetailsOOB = `<div hx-swap-oob="innerHTML:#details-${playlistId}">
      ${playlistDetailsHtml}
    </div>`;

    Logger.info('Sending response with OOB updates including playlist details', {
      playlistId,
      linkedCount,
      totalTracks: updatedSpotifyTracks.length
    });

    // Return response with feedback, updated button, YouTube link, and playlist details (all OOB swaps)
    res.send(`
      <div data-sync-success="true" data-playlist-id="${playlistId}" data-feedback-html="${encodeURIComponent(syncFeedbackHtml)}">
        ${syncFeedbackHtml}
      </div>
      ${updatedButtonHtml}
      ${youtubeLinkHtml}
      ${playlistDetailsOOB}
    `);
    
  } catch (error) {
    Logger.error('Error syncing playlist', { processingTimeMs: Date.now() - startTime }, error);

    // Send error progress update
    sendProgressUpdate(playlistId, {
      type: 'error',
      message: 'Sync failed',
      details: error instanceof Error ? error.message : 'An unexpected error occurred'
    });

    // Close SSE connections after error
    closeProgressConnections(playlistId);

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
        const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
          type: 'warning',
          title: 'YouTube API Quota Exceeded',
          message: "You've reached the daily YouTube API quota limit. The sync was stopped to prevent further errors.",
          details: 'Please try again tomorrow when the quota resets, or consider reducing the number of tracks processed per sync. Some tracks may have been successfully added before hitting the quota limit.'
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

      return res.status(401).send(`
        <div class="alert alert-warning">
          <h5>Authentication Required</h5>
          <p>${service} session has expired. Please reconnect to continue syncing.</p>
          <a href="${loginUrl}" class="btn btn-success btn-sm">
            Reconnect to ${service}
          </a>
        </div>
      `);
    }
    
    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'danger',
      title: 'Error syncing playlist',
      message: 'Something went wrong during the sync process. Please try again.',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).send(html);
  }
});

export { router as syncRouter };
