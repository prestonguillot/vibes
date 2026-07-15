import { Router } from 'express';
import { Logger } from '../lib/logger';
import { getSecureCookieOptions } from '../auth/cookieParser';
import { issueOAuthState, verifyOAuthState } from '../auth/oauthState';
import { validate, schemas, ValidatedRequest } from '../lib/validation';
import { validateAndSerializeYouTubeTokens } from '../auth/cookieParser';
import {
  getYoutubeAuthUrl,
  exchangeYoutubeCode,
  createYoutubeClient,
  YoutubeApiError,
} from '../youtube/client';
import { classifyYoutubeError } from '../youtube/writes';
import { z } from 'zod';

const router = Router();

const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube'];
const YOUTUBE_OAUTH_STATE_COOKIE = 'youtube_oauth_state';

// YouTube login
router.get('/login', (req, res) => {
  Logger.requestStart('YouTube Login Request', {
    requestUrl: req.originalUrl,
  });

  const state = issueOAuthState(res, YOUTUBE_OAUTH_STATE_COOKIE);
  const url = getYoutubeAuthUrl(YOUTUBE_SCOPES, state);
  Logger.auth('YouTube', 'redirecting to authorization', { authorizeURL: url });
  res.redirect(url);
});

// YouTube callback
router.get(
  '/callback',
  validate({
    query: z.object({
      code: schemas.oauthCode,
      state: z.string().optional(),
    }),
  }),
  async (req: ValidatedRequest<Record<string, string>, { code: string; state?: string }>, res) => {
    Logger.requestStart('YouTube Callback Request', {
      requestUrl: req.originalUrl,
      authCodePresent: !!req.query.code,
    });

    const { code, state } = req.query;

    // Reject a callback that didn't originate from our /login (CSRF / account fixation).
    if (!verifyOAuthState(req, res, YOUTUBE_OAUTH_STATE_COOKIE, state, 'YouTube')) {
      return res.redirect('/?error=youtube&reason=state_mismatch');
    }

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
      // A bare 403 is not quota - during OAuth it is far more likely to be a permissions or
      // consent problem, and calling that "quota exceeded" sent the user off to wait for a
      // midnight reset that would never fix it.
      if (classifyYoutubeError(error) === 'quota') {
        errorReason = 'quota_exceeded';
      } else if (error instanceof YoutubeApiError && (error.code === 401 || error.code === 400)) {
        errorReason = 'auth_error';
      }
      res.redirect(`/?error=youtube&reason=${errorReason}`);
    }
  },
);

export { router as youtubeRouter };
