import { Router, Request, Response } from 'express';
import { Logger } from '../utils/logger';
import { validate, schemas } from '../utils/validation';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { parseSpotifyTokenCookie, parseYouTubeTokenCookie } from '../utils/cookieParser';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';

const router = Router();

// Store active SSE connections for each playlist per user
// Key format: "${playlistId}:${youtubeUserId}"
const progressConnections = new Map<string, Response[]>();

// Helper function to get YouTube user ID from cached channel ID in tokens
function getYouTubeUserId(youtubeTokens: YouTubeTokens): string {
  if (!youtubeTokens.channel_id) {
    throw new Error('YouTube channel ID not found in tokens - re-authenticate with YouTube');
  }
  return youtubeTokens.channel_id;
}

// Helper function to verify that a user has a synced playlist for a given Spotify playlist ID
async function verifySyncedPlaylistExists(
  spotifyTokens: SpotifyTokens,
  youtubeTokens: YouTubeTokens,
  spotifyPlaylistId: string
): Promise<boolean> {
  try {
    // Get Spotify playlist name to construct the expected YouTube playlist title
    const spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI
    });
    spotifyApi.setAccessToken(spotifyTokens.accessToken);
    spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

    Logger.external('Spotify', 'Fetching playlist name for verification', { playlistId: spotifyPlaylistId });
    const spotifyPlaylist = await spotifyApi.getPlaylist(spotifyPlaylistId);
    const expectedYouTubePlaylistTitle = `${spotifyPlaylist.body.name} (from Spotify)`;

    // Set up YouTube OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT_URI
    );
    oauth2Client.setCredentials(youtubeTokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Search for the synced YouTube playlist
    Logger.external('YouTube', 'Looking for synced playlist', { title: expectedYouTubePlaylistTitle });

    let nextPageToken: string | undefined = undefined;
    do {
      const playlistsResponse = await youtube.playlists.list({
        part: ['snippet'],
        mine: true,
        maxResults: 50,
        pageToken: nextPageToken
      });

      const foundPlaylist = playlistsResponse.data.items?.find(
        (playlist) => playlist.snippet?.title === expectedYouTubePlaylistTitle
      );

      if (foundPlaylist) {
        Logger.info('Verified synced playlist exists', {
          spotifyPlaylistId,
          youtubePlaylistId: foundPlaylist.id
        });
        return true;
      }

      nextPageToken = playlistsResponse.data.nextPageToken || undefined;
    } while (nextPageToken);

    Logger.warn('Synced playlist not found during verification', {
      spotifyPlaylistId,
      expectedTitle: expectedYouTubePlaylistTitle
    });
    return false;
  } catch (error) {
    Logger.error('Failed to verify synced playlist', { spotifyPlaylistId }, error);
    return false;
  }
}

// SSE endpoint for real-time progress updates
router.get('/playlist/:playlistId',
  validate({
    params: z.object({
      playlistId: schemas.spotifyPlaylistId
    })
  }),
  async (req: Request, res: Response) => {
  const playlistId = req.params.playlistId;

  // 1. Verify authentication - both Spotify and YouTube tokens are required
  const spotifyTokens: SpotifyTokens | null = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);
  const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);

  if (!spotifyTokens || !youtubeTokens) {
    Logger.warn('SSE connection rejected - authentication required', {
      playlistId,
      hasSpotifyTokens: !!spotifyTokens,
      hasYoutubeTokens: !!youtubeTokens
    });

    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'warning',
      title: 'Authentication Required',
      message: 'You must be connected to both Spotify and YouTube to monitor sync progress.',
      details: 'Use the connection buttons at the top of the page to authenticate with both services.'
    });
    return res.status(401).send(html);
  }

  // 2. Verify authorization - the user must have a synced playlist for this Spotify playlist ID
  // Only verify if this is an update (playlist already synced). For new syncs, the playlist doesn't exist yet.
  // If user has valid tokens, they are authorized to create/update their own playlists.
  const syncedPlaylistExists = await verifySyncedPlaylistExists(spotifyTokens, youtubeTokens, playlistId);

  if (!syncedPlaylistExists) {
    // Log it but don't reject - this might be a brand new sync where the playlist doesn't exist yet
    Logger.info('Synced playlist not found (might be a new sync)', { playlistId });
    // Note: We trust the token validation above instead of requiring the playlist to already exist
  }

  // 3. Get YouTube user ID from cached channel ID in tokens
  let youtubeUserId: string;
  try {
    youtubeUserId = getYouTubeUserId(youtubeTokens);
  } catch (error) {
    Logger.error('SSE connection rejected - failed to get user ID', { playlistId }, error);

    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'error',
      title: 'Authentication Error',
      message: 'Failed to verify your YouTube identity.',
      details: 'Please try reconnecting to YouTube. Make sure you\'ve completed the YouTube authentication.'
    });
    return res.status(500).send(html);
  }

  const connectionKey = `${playlistId}:${youtubeUserId}`;
  Logger.info('SSE connection authorized', { playlistId, youtubeUserId, connectionKey });

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
    // Note: No CORS headers - SSE connections should be same-origin only
  });

  // Add this connection to the playlist's connection list (isolated per user)
  if (!progressConnections.has(connectionKey)) {
    progressConnections.set(connectionKey, []);
  }
  progressConnections.get(connectionKey)!.push(res);

  // Send initial keepalive comment (prevents connection timeout)
  res.write(`: SSE connection established\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    Logger.info('SSE connection closed', { playlistId, youtubeUserId, connectionKey });
    const connections = progressConnections.get(connectionKey);
    if (connections) {
      const index = connections.indexOf(res);
      if (index !== -1) {
        connections.splice(index, 1);
      }
      if (connections.length === 0) {
        progressConnections.delete(connectionKey);
      }
    }
  });
});

// Function to send progress update to all connected clients for a playlist (isolated per user)
export async function sendProgressUpdate(playlistId: string, youtubeUserId: string, update: {
  type: 'progress' | 'complete' | 'error';
  message: string;
  details?: string;
  currentTrack?: number;
  totalTracks?: number;
  currentSong?: string;
  currentArtist?: string;
  percentage?: number;
  timestamp?: string;
}) {
  const connectionKey = `${playlistId}:${youtubeUserId}`;
  const connections = progressConnections.get(connectionKey);
  if (!connections || connections.length === 0) {
    return;
  }

  // Generate HTML for the progress update using EJS
  const viewsPath = path.join(__dirname, '../../views');
  const html = await ejs.renderFile(path.join(viewsPath, 'partials/progress-update.ejs'), {
    message: update.message,
    details: update.details,
    percentage: update.percentage || 0,
    type: update.type
  });

  // Minify HTML to single line for SSE format compliance
  // SSE requires data to be on a single line or each line prefixed with "data: "
  const minifiedHtml = html.replace(/\s+/g, ' ').trim();

  Logger.debug('Sending progress update', { connectionKey, clientCount: connections.length, message: update.message });

  // Send to all connected clients for this playlist
  // Use 'message' event type for HTMX SSE extension
  // Keep track of failed connections to remove after iteration
  const failedConnections: Response[] = [];

  connections.forEach((res) => {
    try {
      // Check if the response is still writable before attempting to write
      if (res.writable && !res.writableEnded) {
        res.write(`event: message\ndata: ${minifiedHtml}\n\n`);
      } else {
        // Connection is no longer writable, mark for removal
        failedConnections.push(res);
      }
    } catch (error) {
      Logger.warn('Failed to send progress update to client', { connectionKey }, error);
      // Mark failed connection for removal
      failedConnections.push(res);
    }
  });

  // Remove failed connections after iteration to avoid index issues
  if (failedConnections.length > 0) {
    failedConnections.forEach(failedRes => {
      const index = connections.indexOf(failedRes);
      if (index !== -1) {
        connections.splice(index, 1);
      }
    });
    Logger.debug('Removed dead SSE connections', { connectionKey, removedCount: failedConnections.length, remainingCount: connections.length });
  }

  // Clean up empty connection arrays
  if (connections.length === 0) {
    progressConnections.delete(connectionKey);
  }
}

// Function to close all connections for a playlist per user (when sync completes)
export function closeProgressConnections(playlistId: string, youtubeUserId: string) {
  const connectionKey = `${playlistId}:${youtubeUserId}`;
  const connections = progressConnections.get(connectionKey);
  if (connections) {
    Logger.info('Closing SSE connections', { connectionKey, connectionCount: connections.length });
    connections.forEach(res => {
      try {
        // Send a "close" event to signal graceful shutdown, then end the connection
        // This helps the client distinguish between expected closure and errors
        res.write(`event: close\ndata: ${JSON.stringify({ type: 'close', message: 'Sync complete' })}\n\n`);
        res.end();
      } catch (error) {
        Logger.warn('Error closing SSE connection', { connectionKey }, error);
      }
    });
    progressConnections.delete(connectionKey);
  }
}

export { router as progressRouter };
