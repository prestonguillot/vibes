import { Router } from 'express';
import { google } from 'googleapis';
import { Logger } from '../utils/logger';

const router = Router();

// Create OAuth2 client with current env vars
const getOAuth2Client = () => new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

// Helper function to refresh YouTube tokens if needed
const ensureValidYouTubeToken = async (req: any) => {
  if (!req.session.youtubeTokens) {
    throw new Error('No YouTube tokens found');
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(req.session.youtubeTokens);

  try {
    // Test if current token is valid by making a simple API call
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    return oauth2Client;
  } catch (error: any) {
    // If token is expired (401), try to refresh it
    if (error.code === 401 && req.session.youtubeTokens.refresh_token) {
      Logger.auth('YouTube', 'token expired, refreshing');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Update session with new tokens
        req.session.youtubeTokens = {
          ...req.session.youtubeTokens,
          ...credentials
        };
        oauth2Client.setCredentials(req.session.youtubeTokens);
        
        Logger.auth('YouTube', 'token refreshed successfully');
        return oauth2Client;
      } catch (refreshError) {
        Logger.error('Failed to refresh YouTube token', {}, refreshError);
        throw new Error('YOUTUBE_AUTH_REQUIRED');
      }
    } else {
      throw new Error('YOUTUBE_AUTH_REQUIRED');
    }
  }
};

// YouTube login
router.get('/login', (req, res) => {
  Logger.requestStart('YouTube Login Request', {
    sessionId: req.sessionID,
    requestUrl: req.originalUrl
  });
  
  const oauth2Client = getOAuth2Client();
  const scopes = ['https://www.googleapis.com/auth/youtube'];
  
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  
  Logger.auth('YouTube', 'redirecting to authorization', { authorizeURL: url });
  res.redirect(url);
});

// YouTube callback
router.get('/callback', async (req, res) => {
  Logger.requestStart('YouTube Callback Request', {
    sessionId: req.sessionID,
    requestUrl: req.originalUrl,
    authCodePresent: !!req.query.code
  });
  
  const { code } = req.query;
  
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);
    
    // Store tokens in session
    req.session.youtubeTokens = tokens;
    
    // Redirect back to main page
    res.redirect('/?youtube=connected');
  } catch (error) {
    Logger.error('Error getting YouTube tokens', {}, error);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>YouTube Connection Failed</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #dc3545; color: white; }
          .error { font-size: 24px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="error">YouTube Connection Failed</div>
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

export { router as youtubeRouter, ensureValidYouTubeToken };
