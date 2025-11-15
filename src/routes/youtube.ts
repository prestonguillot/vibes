import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { Logger } from '../utils/logger';
import { getSecureCookieOptions } from '../utils/authValidation';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { YouTubeTokens } from '../types/oauth';
import { parseYouTubeTokenCookie, validateAndSerializeYouTubeTokens } from '../utils/cookieParser';
import { z } from 'zod';

const router = Router();

// Create OAuth2 client with current env vars
const getOAuth2Client = () => new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

// Helper function to refresh YouTube tokens if needed
const ensureValidYouTubeToken = async (req: Request, res: Response) => {
  const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);

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

        // Validate and update cookie with new tokens
        const updatedTokens = {
          ...youtubeTokens,
          ...credentials
        };
        const serializedTokens = validateAndSerializeYouTubeTokens(updatedTokens);
        res.cookie('youtube_tokens', serializedTokens, getSecureCookieOptions());
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

    // Fetch channel ID to cache in tokens (avoids API call later)
    Logger.auth('YouTube', 'fetching channel ID for caching');
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const channelsResponse = await youtube.channels.list({
      part: ['id'],
      mine: true,
      maxResults: 1
    });

    const channelId = channelsResponse.data.items?.[0]?.id;
    if (!channelId) {
      throw new Error('Could not retrieve YouTube channel ID');
    }

    // Add channel ID to tokens before storing
    const tokensWithChannelId = {
      ...tokens,
      channel_id: channelId
    };

    // Validate tokens before storing in cookie
    const serializedTokens = validateAndSerializeYouTubeTokens(tokensWithChannelId);
    res.cookie('youtube_tokens', serializedTokens, getSecureCookieOptions());

    Logger.auth('YouTube', 'tokens with channel ID stored in cookie', { channelId });

    // Redirect back to main page - status endpoint will detect connection and trigger event
    res.redirect('/');
  } catch (error) {
    Logger.error('Error getting YouTube tokens', {}, error);
    // Redirect back to home with error message in cookie
    // so status endpoint can display it to user
    let errorMessage = 'YouTube connection failed. Please try again.';
    if (error instanceof Error) {
      const err = error as any;
      // Check for quota exceeded errors
      if (err.code === 403 || err.errors?.[0]?.reason === 'quotaExceeded') {
        errorMessage = 'YouTube API quota exceeded. Please wait and try again later.';
      } else if (err.code === 401 || err.code === 400) {
        errorMessage = 'YouTube authentication failed. Please try reconnecting.';
      }
    }
    // Set error cookie for status endpoint to display
    res.cookie('youtube_connection_error', encodeURIComponent(errorMessage), {
      httpOnly: false,
      maxAge: 10000, // 10 seconds
      sameSite: 'strict'
    });
    res.redirect('/');
  }
});

export { router as youtubeRouter, ensureValidYouTubeToken };
