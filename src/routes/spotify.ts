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

// Spotify login
router.get('/login', (req, res) => {
  const spotifyApi = getSpotifyApi();
  const scopes = ['playlist-read-private', 'playlist-read-collaborative'];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  res.redirect(authorizeURL);
});

// Spotify callback
router.get('/callback', async (req, res) => {
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
  if (!req.session.spotifyTokens) {
    return res.status(401).send('<div class="alert alert-warning">Please connect to Spotify first</div>');
  }
  
  try {
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
    
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
    const spotifyPlaylists = data.body.items;
    
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
      ? `Showing ${syncedPlaylists.length} synced and ${unsyncedPlaylists.length} unsynced playlists`
      : `Showing ${unsyncedPlaylists.length} playlists (none synced yet)`;
    
    res.send(`
      <div id="playlists-container">
        <h4>Your Spotify Playlists</h4>
        <p class="text-muted mb-3">${summaryText}</p>
        ${playlistsHtml}
      </div>
    `);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).send('<div class="alert alert-danger">Error fetching playlists</div>');
  }
});

export { router as spotifyRouter };
