import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';
import { Logger } from '../utils/logger';

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
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Spotify Connection Failed</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #dc3545; color: white; }
          .error { font-size: 24px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="error">Spotify Connection Failed</div>
        <p>Please try again. You can close this window.</p>
        <script>
          setTimeout(() => {
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
    `);
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
    return res.status(401).send('<div style="margin: 0; padding: 0;">Please connect to Spotify first</div>');
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
    
    const playlistsHtml = sortedPlaylists.map(playlist => {
      const isSynced = youtubePlaylistNames.has(`${playlist.name} (from Spotify)`);
      const syncIcon = isSynced ? '' : '';
      const buttonText = isSynced ? 'Update YouTube Playlist' : 'Sync to YouTube';
      const buttonClass = isSynced ? 'btn-outline-success' : 'btn-primary';
      
      // Get YouTube playlist info if it exists
      const youtubePlaylist = youtubePlaylistsMap.get(`${playlist.name} (from Spotify)`);
      const youtubePlaylistUrl = youtubePlaylist ? 
        `https://www.youtube.com/playlist?list=${youtubePlaylist.id}` : null;

      return `
      <div class="playlist-item" data-playlist-id="${playlist.id}" style="position: relative;">
        <div style="min-height: 40px; display: flex; justify-content: space-between; align-items: flex-start; gap: 5px;">
          <div class="playlist-info" style="flex: 1;">
            <h5 class="mb-1">${syncIcon}${playlist.name}</h5>
            <p class="text-muted mb-1">${playlist.tracks.total} tracks</p>
            
            <!-- Playlist Links -->
            <div class="playlist-links mt-2" style="display: flex; gap: 12px; align-items: center;">
              <a href="${playlist.external_urls.spotify}" target="_blank" 
                 class="text-decoration-none d-flex align-items-center" 
                 style="color: #1DB954; font-size: 0.9rem;"
                 title="Open in Spotify">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="me-1">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                Spotify
              </a>
              ${youtubePlaylistUrl ? `
                <a href="${youtubePlaylistUrl}" target="_blank" 
                   class="text-decoration-none d-flex align-items-center" 
                   style="color: #FF0000; font-size: 0.9rem;"
                   title="Open in YouTube">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="me-1">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  YouTube
                </a>
              ` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-start; flex-shrink: 0;">
            <button class="btn ${buttonClass} sync-btn" 
                    id="sync-btn-${playlist.id}"
                    hx-post="/api/sync/playlist/${playlist.id}"
                    hx-target="#sync-result-${playlist.id}"
                    hx-swap="innerHTML"
                    hx-indicator="#loading"
                    data-playlist-name="${playlist.name}"
                    data-playlist-id="${playlist.id}"
                    style="white-space: nowrap;">
              ${buttonText}
            </button>
          </div>
        </div>
        
        <!-- Progress display area for real-time updates -->
        <div id="progress-${playlist.id}" class="playlist-progress" style="display: none; background: #e3f2fd; border: 1px solid #2196f3; border-top: none; padding: 8px 15px; margin: 0; font-family: 'Courier Prime', monospace; font-size: 0.9rem; color: #1976d2;">
          <div class="progress-content">
            <!-- Progress updates will be inserted here -->
          </div>
        </div>
        
        <!-- Sync result area for final summary -->
        <div id="sync-result-${playlist.id}" style="display: none; margin: 0; padding: 8px 15px; font-family: 'Courier Prime', monospace; font-size: 0.9rem;">
          <!-- Sync completion summary will be inserted here -->
        </div>
        
        ${isSynced ? `
          <div class="playlist-expand-area" 
               data-playlist-id="${playlist.id}"
               data-expanded="false"
               onclick="togglePlaylistDetails('${playlist.id}', this)"
               style="position: relative; left: -20px; right: -20px; width: calc(100% + 40px); height: 50px; cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: center; margin-top: -5px;">
            <span class="expand-indicator" style="font-size: 16px; color: #666; transition: all 0.2s;">▼</span>
          </div>
        ` : ''}
        ${isSynced ? `
          <div class="playlist-details-container" id="details-${playlist.id}" style="display: none; background: #f8f9fa; border: 1px solid #dee2e6; border-top: none; padding: 0; margin: 0; margin-top: 10px !important; position: relative;">
            <div style="margin: 0; padding: 8px; text-align: center; color: #6c757d;">
              <div style="border: 4px solid rgba(0, 0, 0, 0.1); border-top-color: #3498db; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; display: inline-block; vertical-align: middle;">
              </div>
              Click to load playlist details...
            </div>
          </div>
        ` : ''}
      </div>
    `
    }).join('');
    
    const summaryText = syncedPlaylists.length > 0
      ? `Showing ${syncedPlaylists.length} synced and ${unsyncedPlaylists.length} unsynced playlists${ownOnly ? ' (your playlists only)' : ''}`
      : `Showing ${unsyncedPlaylists.length} playlists${ownOnly ? ' (your playlists only)' : ''} (none synced yet)`;

    // Cache for 30 minutes to save YouTube API quota
    res.set('Cache-Control', 'private, max-age=1800');
    Logger.info('Setting cache header for playlists response', { cacheControl: 'private, max-age=1800' });
    res.send(`
      <div>
        <p style="margin: 0; padding: 0;">${summaryText}</p>
        ${playlistsHtml}
      </div>
    `);
  } catch (error) {
    Logger.error('Error fetching playlists', {}, error);
    
    // Check if it's an authentication error
    if (error instanceof Error && error.message === 'SPOTIFY_AUTH_REQUIRED') {
      return res.status(401).send(`
        <div style="margin: 0; padding: 0;">
          <h6>Spotify session expired</h6>
          <p>Please reconnect to Spotify to continue.</p>
          <button style="background-color: #1DB954; color: white; border: none; padding: 8px 16px; font-size: 16px; cursor: pointer;" onclick="window.location.href='/auth/spotify/login'">
            Reconnect to Spotify
          </button>
        </div>
      `);
    }
    
    res.status(500).send('<div style="margin: 0; padding: 0;">Error fetching playlists</div>');
  }
});

export { router as spotifyRouter };
