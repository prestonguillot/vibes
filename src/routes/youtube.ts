import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { Logger } from '../utils/logger';
import { getSecureCookieOptions } from '../utils/authValidation';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { YouTubeTokens } from '../types/oauth';
import { z } from 'zod';
import { parseYouTubeTokens } from '../utils/tokenParsing';

const router = Router();

// Create OAuth2 client with current env vars
const getOAuth2Client = () => new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

// Helper function to refresh YouTube tokens if needed
const ensureValidYouTubeToken = async (req: Request, res: Response) => {
  const youtubeTokens: YouTubeTokens | null = parseYouTubeTokens(req.cookies.youtube_tokens);

  if (!youtubeTokens) {
    throw new Error('No YouTube tokens found');
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(youtubeTokens);

  try {
    // Test if current token is valid by making a simple API call
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    return oauth2Client;
  } catch (error: unknown) {
    // If token is expired (401), try to refresh it
    const errorCode = (error as { code?: number }).code;
    if (errorCode === 401 && youtubeTokens.refresh_token) {
      Logger.auth('YouTube', 'token expired, refreshing');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Update cookie with new tokens
        const updatedTokens = {
          ...youtubeTokens,
          ...credentials
        };
        res.cookie('youtube_tokens', JSON.stringify(updatedTokens), getSecureCookieOptions());
        oauth2Client.setCredentials(updatedTokens);

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
router.get('/callback',
  validate({
    query: z.object({
      code: schemas.oauthCode
    })
  }),
  async (req: ValidatedRequest<Record<string, string>, { code: string }>, res) => {
  Logger.requestStart('YouTube Callback Request', {
    requestUrl: req.originalUrl,
    authCodePresent: !!req.query.code
  });

  const { code } = req.query;

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // Store tokens in httpOnly cookie
    res.cookie('youtube_tokens', JSON.stringify(tokens), getSecureCookieOptions());

    Logger.auth('YouTube', 'tokens stored in cookie');

    // Redirect back to main page - status endpoint will detect connection and trigger event
    res.redirect('/');
  } catch (error) {
    Logger.error('Error getting YouTube tokens', {}, error);
    res.render('partials/oauth-error', { service: 'YouTube' });
  }
});

export { router as youtubeRouter, ensureValidYouTubeToken };
