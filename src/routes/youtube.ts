import { Router } from 'express';
import { google } from 'googleapis';

const router = Router();

// Create OAuth2 client with current env vars
const getOAuth2Client = () => new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

// YouTube login
router.get('/login', (req, res) => {
  const oauth2Client = getOAuth2Client();
  const scopes = ['https://www.googleapis.com/auth/youtube'];
  
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  
  res.redirect(url);
});

// YouTube callback
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);
    
    // Store tokens in session
    req.session.youtubeTokens = tokens;
    
    res.redirect('/?youtube=connected');
  } catch (error) {
    console.error('Error getting YouTube tokens:', error);
    res.redirect('/?error=youtube_auth_failed');
  }
});

export { router as youtubeRouter };
