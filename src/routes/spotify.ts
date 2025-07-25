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
  console.log('\n🔗 === SPOTIFY LOGIN REQUEST ===');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`👤 Session ID: ${req.sessionID}`);
  console.log(`🔗 Request URL: ${req.originalUrl}`);
  
  const spotifyApi = getSpotifyApi();
  const scopes = ['playlist-read-private', 'playlist-read-collaborative'];
  
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  console.log(`🎯 Redirecting to: ${authorizeURL}`);
  
  res.redirect(authorizeURL);
});

// Spotify callback
router.get('/callback', async (req, res) => {
  console.log('\n📞 === SPOTIFY CALLBACK REQUEST ===');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`👤 Session ID: ${req.sessionID}`);
  console.log(`🔗 Request URL: ${req.originalUrl}`);
  console.log(`🔑 Authorization code: ${req.query.code ? 'present' : 'missing'}`);
  
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
    
    res.redirect('/?spotify=connected');
  } catch (error) {
    console.error('Error getting Spotify tokens:', error);
    res.redirect('/?error=spotify_auth_failed');
  }
});

// Get user playlists
router.get('/playlists', async (req, res) => {
  console.log('\n📚 === SPOTIFY PLAYLISTS REQUEST ===');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`👤 Session ID: ${req.sessionID}`);
  console.log(`🔗 Request URL: ${req.originalUrl}`);
  console.log(`🔍 Query parameters: ${JSON.stringify(req.query)}`);
  
  if (!req.session.spotifyTokens) {
    return res.status(401).send('<div class="alert alert-warning">Please connect to Spotify first</div>');
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
      const syncIcon = isSynced ? '✅ ' : '';
      const buttonText = isSynced ? 'Update YouTube Playlist' : 'Sync to YouTube';
      const buttonClass = isSynced ? 'btn-success' : 'btn-primary';
      
      return `
        <div class="playlist-item" data-playlist-id="${playlist.id}">
          <div class="playlist-info">
            <h5>${syncIcon}${playlist.name}</h5>
            <p class="text-muted">${playlist.tracks.total} tracks</p>
            ${isSynced ? '<small class="text-success">Previously synced to YouTube</small>' : ''}
          </div>
          <button class="btn ${buttonClass} sync-btn" 
                  hx-post="/api/sync/playlist/${playlist.id}"
                  hx-target="#sync-result"
                  hx-indicator="#loading"
                  data-playlist-name="${playlist.name}"
                  data-playlist-id="${playlist.id}">
            ${buttonText}
          </button>
        </div>
      `;
    }).join('');
    
    const summaryText = syncedPlaylists.length > 0 
      ? `Showing ${syncedPlaylists.length} synced and ${unsyncedPlaylists.length} unsynced playlists${ownOnly ? ' (your playlists only)' : ''}`
      : `Showing ${unsyncedPlaylists.length} playlists${ownOnly ? ' (your playlists only)' : ''} (none synced yet)`;
    
    res.send(`
      <div>
        <p class="text-muted mb-3">${summaryText}</p>
        ${playlistsHtml}
      </div>
    `);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    
    // Check if it's an authentication error
    if (error instanceof Error && error.message === 'SPOTIFY_AUTH_REQUIRED') {
      return res.status(401).send(`
        <div class="alert alert-warning">
          <h6>Spotify session expired</h6>
          <p>Please reconnect to Spotify to continue.</p>
          <button class="btn btn-success btn-sm" onclick="window.location.href='/auth/spotify/login'">
            Reconnect to Spotify
          </button>
        </div>
      `);
    }
    
    res.status(500).send('<div class="alert alert-danger">Error fetching playlists</div>');
  }
});

export { router as spotifyRouter };
