import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';

const router = Router();

// Create Spotify API instance with current env vars
const getSpotifyApi = () => new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

// Helper function to refresh Spotify tokens if needed
const ensureValidSpotifyToken = async (req: any) => {
  if (!req.session.spotifyTokens) {
    throw new Error('No Spotify tokens found');
  }

  const spotifyApi = getSpotifyApi();
  spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
  spotifyApi.setRefreshToken(req.session.spotifyTokens.refreshToken);

  try {
    // Test if current token is valid by making a simple API call
    await spotifyApi.getMe();
    return spotifyApi;
  } catch (error: any) {
    // If token is expired (401), try to refresh it
    if (error.statusCode === 401 && req.session.spotifyTokens.refreshToken) {
      console.log('Spotify token expired, refreshing...');
      try {
        const data = await spotifyApi.refreshAccessToken();
        const { access_token } = data.body;
        
        // Update session with new token
        req.session.spotifyTokens.accessToken = access_token;
        spotifyApi.setAccessToken(access_token);
        
        console.log('Spotify token refreshed successfully');
        return spotifyApi;
      } catch (refreshError) {
        console.error('Failed to refresh Spotify token:', refreshError);
        throw new Error('SPOTIFY_AUTH_REQUIRED');
      }
    } else {
      throw new Error('SPOTIFY_AUTH_REQUIRED');
    }
  }
};

// Spotify login
router.get('/login', (req, res) => {
  console.log('\n === SPOTIFY LOGIN REQUEST ===');
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(` Session ID: ${req.sessionID}`);
  console.log(` Request URL: ${req.originalUrl}`);
  
  const spotifyApi = getSpotifyApi();
  const scopes = ['playlist-read-private', 'playlist-read-collaborative'];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  console.log(` Redirecting to: ${authorizeURL}`);
  
  res.redirect(authorizeURL);
});

// Spotify callback
router.get('/callback', async (req, res) => {
  console.log('\n === SPOTIFY CALLBACK REQUEST ===');
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(` Session ID: ${req.sessionID}`);
  console.log(` Request URL: ${req.originalUrl}`);
  console.log(` Authorization code: ${req.query.code ? 'present' : 'missing'}`);
  
  const { code } = req.query;
  
  try {
    const spotifyApi = getSpotifyApi();
    const data = await spotifyApi.authorizationCodeGrant(code as string);
    const { access_token, refresh_token } = data.body;
    
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    
    // Store tokens in session
    req.session.spotifyTokens = {
      accessToken: access_token,
      refreshToken: refresh_token
    };
    
    // For popup OAuth, send a page that closes the popup
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Spotify Connected</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #1DB954; color: white; }
          .success { font-size: 24px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="success">Spotify Connected Successfully!</div>
        <p>You can close this window.</p>
        <script>
          // Close popup after a brief delay
          setTimeout(() => {
            window.close();
          }, 1500);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error getting Spotify tokens:', error);
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
  console.log('\n === SPOTIFY PLAYLISTS REQUEST ===');
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(` Session ID: ${req.sessionID}`);
  console.log(` Request URL: ${req.originalUrl}`);
  console.log(` Query parameters: ${JSON.stringify(req.query)}`);
  
  if (!req.session.spotifyTokens) {
    return res.status(401).send('<div style="margin: 0; padding: 0;">Please connect to Spotify first</div>');
  }
  
  try {
    const spotifyApi = await ensureValidSpotifyToken(req);
    
    // Get current user info for ownership filtering
    const userInfo = await spotifyApi.getMe();
    const currentUserId = userInfo.body.id;
    
    // Set up YouTube API to check for existing playlists
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT_URI
    );
    oauth2Client.setCredentials(req.session.youtubeTokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    // Get Spotify playlists
    const data = await spotifyApi.getUserPlaylists();
    let spotifyPlaylists = data.body.items;
    
    // Filter for own playlists only if requested
    const ownOnly = req.query.ownOnly === 'true';
    if (ownOnly) {
      spotifyPlaylists = spotifyPlaylists.filter(playlist => 
        playlist.owner.id === currentUserId
      );
    }
    
    // Get YouTube playlists to check which Spotify playlists have been synced
    let youtubePlaylistNames = new Set<string>();
    if (req.session.youtubeTokens) {
      try {
        const youtubeResponse = await youtube.playlists.list({
          part: ['snippet'],
          mine: true,
          maxResults: 50
        });
        
        if (youtubeResponse.data.items) {
          youtubePlaylistNames = new Set(
            youtubeResponse.data.items.map(playlist => playlist.snippet?.title || '')
          );
        }
      } catch (error) {
        console.log('Could not fetch YouTube playlists for sorting:', error);
        // Continue without YouTube playlist info
      }
    }
    
    // Categorize and sort playlists
    // Check if a Spotify playlist has been synced by looking for a YouTube playlist with " (from Spotify)" suffix
    const syncedPlaylists = spotifyPlaylists
      .filter(playlist => youtubePlaylistNames.has(`${playlist.name} (from Spotify)`))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    const unsyncedPlaylists = spotifyPlaylists
      .filter(playlist => !youtubePlaylistNames.has(`${playlist.name} (from Spotify)`))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    // Combine with synced playlists first
    const sortedPlaylists = [...syncedPlaylists, ...unsyncedPlaylists];
    
    const playlistsHtml = sortedPlaylists.map(playlist => {
      const isSynced = youtubePlaylistNames.has(`${playlist.name} (from Spotify)`);
      const syncIcon = isSynced ? '' : '';
      const buttonText = isSynced ? 'Update YouTube Playlist' : 'Sync to YouTube';
      const buttonClass = isSynced ? 'btn-outline-success' : 'btn-primary';

      return `
      <div class="playlist-item" data-playlist-id="${playlist.id}" style="position: relative;">
        <div style="min-height: 40px; display: flex; justify-content: space-between; align-items: flex-start; gap: 5px;">
          <div class="playlist-info" style="flex: 1;">
            <h5 class="mb-1">${syncIcon}${playlist.name}</h5>
            <p class="text-muted mb-1">${playlist.tracks.total} tracks</p>
            ${isSynced ? '<small class="text-success">Previously synced to YouTube</small>' : ''}
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-start; flex-shrink: 0;">
            <button class="btn ${buttonClass} sync-btn" 
                    id="sync-btn-${playlist.id}"
                    hx-post="/api/sync/playlist/${playlist.id}"
                    hx-target="#sync-result"
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
        
        ${isSynced ? `
          <div class="playlist-expand-area" 
               data-playlist-id="${playlist.id}"
               data-expanded="false"
               onclick="togglePlaylistDetails('${playlist.id}', this)"
               style="position: relative; left: -20px; right: -20px; width: calc(100% + 40px); height: 50px; cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: center; margin-top: -10px;">
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
    
    res.send(`
      <div>
        <p style="margin: 0; padding: 0;">${summaryText}</p>
        ${playlistsHtml}
      </div>
    `);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    
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
