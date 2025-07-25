import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';

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
    const data = await spotifyApi.getUserPlaylists();
    
    const playlistsHtml = data.body.items.map(playlist => `
      <div class="playlist-item" data-playlist-id="${playlist.id}">
        <div class="playlist-info">
          <h5>${playlist.name}</h5>
          <p class="text-muted">${playlist.tracks.total} tracks</p>
        </div>
        <button class="btn btn-primary sync-btn" 
                hx-post="/api/sync/playlist/${playlist.id}"
                hx-target="#sync-result"
                hx-indicator="#loading"
                data-playlist-name="${playlist.name}"
                data-playlist-id="${playlist.id}">
          Sync to YouTube
        </button>
      </div>
    `).join('');
    
    res.send(`
      <div id="playlists-container">
        <h4>Your Spotify Playlists</h4>
        ${playlistsHtml}
      </div>
    `);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).send('<div class="alert alert-danger">Error fetching playlists</div>');
  }
});

export { router as spotifyRouter };
