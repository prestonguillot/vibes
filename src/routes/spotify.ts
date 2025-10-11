import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';
import { Logger } from '../utils/logger';
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
  const spotifyTokens = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;

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

        // Update cookie with new token
        const updatedTokens = { ...spotifyTokens, accessToken: access_token };
        res.cookie('spotify_tokens', JSON.stringify(updatedTokens), {
          httpOnly: true,
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
          sameSite: 'lax'
        });
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
router.get('/callback', async (req, res) => {
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

    // Store tokens in httpOnly cookie
    res.cookie('spotify_tokens', JSON.stringify({
      accessToken: access_token,
      refreshToken: refresh_token
    }), {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax'
    });

    Logger.auth('Spotify', 'tokens stored in cookie');

    // Redirect back to main page
    res.redirect('/?spotify=connected');
  } catch (error) {
    Logger.error('Error getting Spotify tokens', {}, error);
    res.render('partials/oauth-error', { service: 'Spotify' });
  }
});

// Get user's playlists with improved layout - testing hot reload
router.get('/playlists', async (req, res) => {
  Logger.requestStart('Spotify Playlists Request', {
    requestUrl: req.originalUrl,
    queryParams: req.query
  });

  const spotifyTokens = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;
  if (!spotifyTokens) {
    return res.status(401).render('partials/error-message', { message: 'Please connect to Spotify first' });
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
    const youtubeTokens = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;
    if (youtubeTokens) {
      oauth2Client.setCredentials(youtubeTokens);
    }
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    // Get Spotify playlists
    const data = await spotifyApi.getUserPlaylists();
    let spotifyPlaylists = data.body.items;
    
    // Filter for own playlists only if requested
    const ownOnly = req.query.ownOnly === 'true';
    if (ownOnly) {
      spotifyPlaylists = spotifyPlaylists.filter((playlist: any) =>
        playlist.owner.id === currentUserId
      );
    }

    // Get YouTube playlists to check which Spotify playlists have been synced
    let youtubePlaylistNames = new Set<string>();
    let youtubePlaylistsMap = new Map<string, any>();
    if (youtubeTokens) {
      try {
        const youtubeResponse = await youtube.playlists.list({
          part: ['snippet'],
          mine: true,
          maxResults: 50
        });

        if (youtubeResponse.data.items) {
          youtubeResponse.data.items.forEach(playlist => {
            const title = playlist.snippet?.title || '';
            youtubePlaylistNames.add(title);
            youtubePlaylistsMap.set(title, playlist);
          });
        }
      } catch (error) {
        Logger.warn('Could not fetch YouTube playlists for sorting', {}, error);
        // Continue without YouTube playlist info
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
    const playlistItemTemplate = await ejs.renderFile(
      path.join(viewsPath, 'partials/playlist-item.ejs'),
      {},
      { async: true }
    );

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
        buttonClass
      });
    })).then(items => items.join(''));
    
    const summaryText = syncedPlaylists.length > 0
      ? `Showing ${syncedPlaylists.length} synced and ${unsyncedPlaylists.length} unsynced playlists${ownOnly ? ' (your playlists only)' : ''}`
      : `Showing ${unsyncedPlaylists.length} playlists${ownOnly ? ' (your playlists only)' : ''} (none synced yet)`;

    // Cache for 30 minutes to save YouTube API quota
    res.set('Cache-Control', 'private, max-age=1800');
    Logger.info('Setting cache header for playlists response', { cacheControl: 'private, max-age=1800' });
    res.render('partials/playlist-list-container', { summaryText, playlistsHtml });
  } catch (error) {
    Logger.error('Error fetching playlists', {}, error);
    
    // Check if it's an authentication error
    if (error instanceof Error && error.message === 'SPOTIFY_AUTH_REQUIRED') {
      return res.status(401).render('partials/auth-expired', { service: 'Spotify' });
    }

    res.status(500).render('partials/error-message', { message: 'Error fetching playlists' });
  }
});

export { router as spotifyRouter };
