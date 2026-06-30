import { Router } from 'express';
import { Logger } from '../utils/logger';
import { getSecureCookieOptions } from '../utils/authValidation';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { validateAndSerializeYouTubeTokens } from '../utils/cookieParser';
import {
  getYoutubeAuthUrl,
  exchangeYoutubeCode,
  createYoutubeClient,
  YoutubeApiError,
} from '../utils/youtubeClient';
import { z } from 'zod';

const router = Router();

const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube'];

// YouTube login
router.get('/login', (req, res) => {
  Logger.requestStart('YouTube Login Request', {
    requestUrl: req.originalUrl,
  });

  const url = getYoutubeAuthUrl(YOUTUBE_SCOPES);
  Logger.auth('YouTube', 'redirecting to authorization', { authorizeURL: url });
  res.redirect(url);
});

// YouTube callback
router.get(
  '/callback',
  validate({
    query: z.object({
      code: schemas.oauthCode,
    }),
  }),
  async (req: ValidatedRequest<Record<string, string>, { code: string }>, res) => {
    Logger.requestStart('YouTube Callback Request', {
      requestUrl: req.originalUrl,
      authCodePresent: !!req.query.code,
    });

    const { code } = req.query;

    try {
      const tokens = await exchangeYoutubeCode(code as string);

      // Fetch channel ID to cache in tokens (avoids an API call later)
      Logger.auth('YouTube', 'fetching channel ID for caching');
      const youtube = createYoutubeClient(tokens.access_token);
      const channelsResponse = await youtube.channels.list({
        part: ['id'],
        mine: true,
        maxResults: 1,
      });

      const channelId = channelsResponse.data.items?.[0]?.id;
      if (!channelId) {
        throw new Error('Could not retrieve YouTube channel ID');
      }

      // Validate tokens (with channel id) before storing in cookie
      const serializedTokens = validateAndSerializeYouTubeTokens({
        ...tokens,
        channel_id: channelId,
      });
      res.cookie('youtube_tokens', serializedTokens, getSecureCookieOptions());

      Logger.auth('YouTube', 'tokens with channel ID stored in cookie', { channelId });

      // Redirect back to main page - status endpoint will detect connection and trigger event
      res.redirect('/');
    } catch (error) {
      Logger.error('Error getting YouTube tokens', {}, error);
      let errorReason = 'failed';
      if (error instanceof YoutubeApiError) {
        if (error.code === 403 || error.reason === 'quotaExceeded') {
          errorReason = 'quota_exceeded';
        } else if (error.code === 401 || error.code === 400) {
          errorReason = 'auth_error';
        }
      }
      res.redirect(`/?error=youtube&reason=${errorReason}`);
    }
  },
);

export { router as youtubeRouter };
