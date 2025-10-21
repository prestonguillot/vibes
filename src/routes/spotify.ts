import { Router, Request } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google, youtube_v3 } from 'googleapis';
import { Logger } from '../utils/logger';
import { getSecureCookieOptions } from '../utils/authValidation';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { CacheDuration, setCache } from '../utils/cache';
import { youtubeCircuitBreaker } from '../utils/circuitBreaker';
import { parseSpotifyTokenCookie, parseYouTubeTokenCookie, validateAndSerializeSpotifyTokens } from '../utils/cookieParser';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';

const router = Router();

// Create Spotify API instance with current env vars
const getSpotifyApi = () => new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

// Helper function to refresh Spotify tokens if needed
const ensureValidSpotifyToken = async (req: any, res: any) => {
  const spotifyTokens = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);

  if (!spotifyTokens) {
    throw new Error('No Spotify tokens found');
  }

  const spotifyApi = getSpotifyApi();
  spotifyApi.setAccessToken(spotifyTokens.accessToken);
  spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

  try {
    // Test if current token is valid by making a simple API call
    await spotifyApi.getMe();
    return spotifyApi;
  } catch (error: any) {
    // If token is expired (401), try to refresh it
    if (error.statusCode === 401 && spotifyTokens.refreshToken) {
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

// Spotify login
router.get('/login', (req, res) => {
  Logger.requestStart('Spotify Login Request', {
    requestUrl: req.originalUrl
  });
  
  const spotifyApi = getSpotifyApi();
  const scopes = ['playlist-read-private', 'playlist-read-collaborative'];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, '');
  Logger.auth('Spotify', 'redirecting to authorization', { authorizeURL });

  res.redirect(authorizeURL);
});

// Spotify callback
router.get('/callback',
  validate({
    query: z.object({
      code: schemas.oauthCode
    })
  }),
  async (req, res) => {
  Logger.requestStart('Spotify Callback Request', {
    requestUrl: req.originalUrl,
    authCodePresent: !!req.query.code
  });

  const { code } = req.query;

  try {
    const spotifyApi = getSpotifyApi();
    const data = await spotifyApi.authorizationCodeGrant(code as string);
    const { access_token, refresh_token } = data.body;

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    // Validate tokens before storing in cookie
    const serializedTokens = validateAndSerializeSpotifyTokens({
      accessToken: access_token,
      refreshToken: refresh_token
    });

    res.cookie('spotify_tokens', serializedTokens, getSecureCookieOptions());

    Logger.auth('Spotify', 'tokens stored in cookie');

    // Redirect back to main page - status endpoint will detect connection
    res.redirect('/');
  } catch (error) {
    Logger.error('Error getting Spotify tokens', {}, error);
    res.render('partials/oauth-error', { service: 'Spotify' });
  }
});

// Get user's playlists with improved layout - testing hot reload
router.get('/playlists',
  validate({
    query: z.object({
      ownOnly: schemas.booleanFlag.optional()
    })
  }),
  async (req: ValidatedRequest<Record<string, string>, { ownOnly?: boolean }>, res) => {
  Logger.requestStart('Spotify Playlists Request', {
    requestUrl: req.originalUrl,
    queryParams: req.query
  });

  const spotifyTokens = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);
  if (!spotifyTokens) {
    return res.status(401).render('partials/error-message', { message: 'Please connect to Spotify first', type: 'warning' });
  }

  try {
    const spotifyApi = await ensureValidSpotifyToken(req, res);

    // Get current user info for ownership filtering
    const userInfo = await spotifyApi.getMe();
    const currentUserId = userInfo.body.id;

    // Set up YouTube API to check for existing playlists
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT_URI
    );
    let youtubeTokens = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);
    if (youtubeTokens) {
      oauth2Client.setCredentials(youtubeTokens);
    }
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Get Spotify playlists
    const data = await spotifyApi.getUserPlaylists();
    let spotifyPlaylists = data.body.items;

    // Filter for own playlists only if requested
    // Note: Zod transforms the string 'true'/'false' to boolean true/false
    const ownOnly = req.query.ownOnly === true;
    Logger.debug('Playlist filtering', {
      ownOnly,
      currentUserId,
      totalPlaylists: spotifyPlaylists.length,
      rawQueryParam: req.query.ownOnly
    });

    if (ownOnly) {
      const beforeFilter = spotifyPlaylists.length;
      spotifyPlaylists = spotifyPlaylists.filter((playlist: any) =>
        playlist.owner.id === currentUserId
      );
      Logger.debug('Applied ownOnly filter', {
        before: beforeFilter,
        after: spotifyPlaylists.length,
        currentUserId
      });
    }

    // Get ALL YouTube playlists to check which Spotify playlists have been synced (with pagination)
    let youtubePlaylistNames = new Set<string>();
    let youtubePlaylistsMap = new Map<string, any>();

    if (youtubeTokens) {
      // Check circuit breaker before making API calls
      if (!youtubeCircuitBreaker.canProceed()) {
        Logger.warn('YouTube API circuit breaker is OPEN, clearing YouTube tokens', {
          state: youtubeCircuitBreaker.getState()
        });
        // Clear YouTube tokens so user sees disconnected state
        res.clearCookie('youtube_tokens');
        youtubeTokens = null;
      } else {
        try {
          let nextPageToken: string | undefined = undefined;

          do {
            const youtubeResponse: youtube_v3.Schema$PlaylistListResponse = await youtube.playlists.list({
              part: ['snippet'],
              mine: true,
              maxResults: 50,
              pageToken: nextPageToken
            }).then(res => res.data);

            if (youtubeResponse.items) {
              youtubeResponse.items.forEach((playlist: youtube_v3.Schema$Playlist) => {
                const title = playlist.snippet?.title || '';
                youtubePlaylistNames.add(title);
                youtubePlaylistsMap.set(title, playlist);
              });
            }

            nextPageToken = youtubeResponse.nextPageToken || undefined;
          } while (nextPageToken);

          // Success - record it
          youtubeCircuitBreaker.recordSuccess();
        } catch (error: any) {
          const errorCode = error?.code;
          if (errorCode === 403) {
            Logger.warn('YouTube API quota exceeded when fetching playlists, clearing tokens', { errorCode });
            // Open circuit breaker for quota errors
            youtubeCircuitBreaker.open();
            // Clear YouTube tokens so user sees disconnected state
            res.clearCookie('youtube_tokens');
            youtubeTokens = null;
          } else {
            Logger.warn('Could not fetch YouTube playlists for sorting', {}, error);
            // Record failure but don't necessarily open circuit (might be transient)
            youtubeCircuitBreaker.recordFailure(error);
          }
          // Continue without YouTube playlist info
        }
      }
    }

    // Categorize and sort playlists
    // Check if a Spotify playlist has been synced by looking for a YouTube playlist with " (from Spotify)" suffix
    const syncedPlaylists = spotifyPlaylists
      .filter((playlist: any) => youtubePlaylistNames.has(`${playlist.name} (from Spotify)`))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    const unsyncedPlaylists = spotifyPlaylists
      .filter((playlist: any) => !youtubePlaylistNames.has(`${playlist.name} (from Spotify)`))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
    
    // Combine with synced playlists first
    const sortedPlaylists = [...syncedPlaylists, ...unsyncedPlaylists];

    const viewsPath = path.join(__dirname, '../../views');

    const playlistsHtml = await Promise.all(sortedPlaylists.map(async (playlist: any) => {
      const isSynced = youtubePlaylistNames.has(`${playlist.name} (from Spotify)`);
      const syncIcon = isSynced ? '' : '';
      const buttonText = isSynced ? 'Update YouTube Playlist' : 'Sync to YouTube';
      const buttonClass = isSynced ? 'btn-outline-success' : 'btn-primary';

      // Get YouTube playlist info if it exists
      const youtubePlaylist = youtubePlaylistsMap.get(`${playlist.name} (from Spotify)`);
      const youtubePlaylistUrl = youtubePlaylist ?
        `https://www.youtube.com/playlist?list=${youtubePlaylist.id}` : undefined;

      return await ejs.renderFile(path.join(viewsPath, 'partials/playlist-item.ejs'), {
        id: playlist.id,
        name: playlist.name,
        tracksTotal: playlist.tracks.total,
        spotifyUrl: playlist.external_urls.spotify,
        youtubeUrl: youtubePlaylistUrl,
        isSynced,
        syncIcon,
        buttonText,
        buttonClass,
        isYouTubeConnected: !!youtubeTokens,
        isDisabled: false
      });
    })).then(items => items.join(''));

    // Create summary text - different messages based on YouTube connection and sync status
    let summaryText: string;
    if (!youtubeTokens) {
      // YouTube not connected - can't determine sync status
      summaryText = `Showing ${spotifyPlaylists.length} playlists`;
    } else if (syncedPlaylists.length > 0) {
      // YouTube connected and some playlists are synced
      summaryText = `Showing ${syncedPlaylists.length} synced and ${unsyncedPlaylists.length} unsynced playlists`;
    } else {
      // YouTube connected but no playlists synced yet
      summaryText = `Showing ${unsyncedPlaylists.length} playlists (none synced yet)`;
    }

    // Cache for 30 minutes (LONG) - saves YouTube API quota
    // This is expensive because it checks ALL YouTube playlists for sync status
    // Playlist lists change infrequently compared to playlist contents
    setCache(res, CacheDuration.LONG);
    Logger.info('Setting cache header for playlists response', { cacheDuration: CacheDuration.LONG });
    res.render('partials/playlist-list-container', { summaryText, playlistsHtml });
  } catch (error) {
    Logger.error('Error fetching playlists', {}, error);

    // Check if it's an authentication error
    if (error instanceof Error && error.message === 'SPOTIFY_AUTH_REQUIRED') {
      return res.status(401).render('partials/auth-expired', { service: 'Spotify' });
    }

    // Check if it's a Spotify API server error (502/503)
    const statusCode = (error as any)?.statusCode || (error as any)?.status;
    if (statusCode === 502 || statusCode === 503) {
      Logger.warn('Spotify API temporary error', { statusCode });
      return res.status(503).render('partials/error-message', {
        message: 'Spotify is temporarily unavailable',
        type: 'warning',
        details: 'Spotify\'s servers are experiencing issues. Please try again in a few moments.'
      });
    }

    // Check for rate limiting (429)
    if (statusCode === 429) {
      Logger.warn('Spotify API rate limit exceeded', { statusCode });
      return res.status(429).render('partials/error-message', {
        message: 'Too many requests to Spotify',
        type: 'warning',
        details: 'Please wait a moment before trying again.'
      });
    }

    res.status(500).render('partials/error-message', { message: 'Error fetching playlists', type: 'danger' });
  }
});

// Get sync button for a playlist (for refresh after sync)
router.get('/playlist-button/:playlistId',
  validate({
    params: z.object({
      playlistId: schemas.spotifyPlaylistId
    })
  }),
  async (req: ValidatedRequest<{ playlistId: string }>, res) => {
  Logger.requestStart('Spotify Playlist Button Request', {
    playlistId: req.params.playlistId
  });

  const spotifyTokens = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;
  const youtubeTokens = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;

  if (!spotifyTokens) {
    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-button-disabled.ejs'), {
      message: 'Connect to Spotify First'
    });
    return res.status(401).send(html);
  }

  if (!youtubeTokens) {
    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-button-disabled.ejs'), {
      message: 'Connect to YouTube to Sync',
      title: 'Connect to YouTube first'
    });
    return res.send(html);
  }

  try {
    const spotifyApi = await ensureValidSpotifyToken(req, res);
    const { playlistId } = req.params;

    // Get this specific playlist
    const playlistData = await spotifyApi.getPlaylist(playlistId);
    const playlist = playlistData.body;

    // Set up YouTube API to check if this playlist has been synced
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT_URI
    );
    oauth2Client.setCredentials(youtubeTokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Check if a YouTube playlist exists for this Spotify playlist
    let isSynced = false;

    try {
      const playlistTitle = `${playlist.name} (from Spotify)`;

      // Search for the YouTube playlist (paginate if necessary)
      let nextPageToken: string | undefined = undefined;
      let foundPlaylist: youtube_v3.Schema$Playlist | undefined = undefined;

      do {
        const youtubeResponse: youtube_v3.Schema$PlaylistListResponse = await youtube.playlists.list({
          part: ['snippet'],
          mine: true,
          maxResults: 50,
          pageToken: nextPageToken
        }).then(res => res.data);

        foundPlaylist = youtubeResponse.items?.find((p: youtube_v3.Schema$Playlist) =>
          p.snippet?.title === playlistTitle
        );

        if (foundPlaylist) break;
        nextPageToken = youtubeResponse.nextPageToken || undefined;
      } while (nextPageToken);

      if (foundPlaylist) {
        isSynced = true;
      }
    } catch (error) {
      Logger.warn('Error checking YouTube playlist status', {}, error);
      // Continue without YouTube status
    }

    const buttonText = isSynced ? 'Update YouTube Playlist' : 'Sync to YouTube';
    const buttonClass = isSynced ? 'btn-outline-success' : 'btn-primary';

    // Render button from template
    const buttonHtml = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-button.ejs'), {
      buttonClass,
      playlistId,
      playlistName: playlist.name,
      trackCount: playlist.tracks.total,
      buttonText
    });

    res.send(buttonHtml);
  } catch (error) {
    Logger.error('Error fetching playlist button', {}, error);

    if (error instanceof Error && error.message === 'SPOTIFY_AUTH_REQUIRED') {
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-button-disabled.ejs'), {
        message: 'Reconnect to Spotify'
      });
      return res.status(401).send(html);
    }

    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/sync-button-disabled.ejs'), {
      message: 'Error'
    });
    res.status(500).send(html);
  }
});

export { router as spotifyRouter };
