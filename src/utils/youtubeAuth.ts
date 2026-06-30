/**
 * Shared YouTube token validation/refresh for request handlers (mirrors
 * spotifyAuth). Validates the cookie's access token with a lightweight
 * channels.list; on 401 it refreshes (reusing the stored refresh token, which
 * Google doesn't re-issue), rewrites the cookie, and returns a client bound to a
 * valid token. Throws Error('YOUTUBE_AUTH_REQUIRED') when the user must reconnect.
 */

import { Request, Response } from 'express';
import { createYoutubeClient, refreshYoutubeAccessToken, YoutubeApiError, YoutubeClient } from './youtubeClient';
import { parseYouTubeTokenCookie, validateAndSerializeYouTubeTokens } from './cookieParser';
import { getSecureCookieOptions } from './authValidation';
import { Logger } from './logger';

export interface ValidYouTube {
  client: YoutubeClient;
  accessToken: string;
  /** Quota units spent validating (channels.list = 1). */
  quotaUsed: number;
}

export async function ensureValidYouTubeToken(req: Request, res: Response): Promise<ValidYouTube> {
  const tokens = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);
  if (!tokens) {
    throw new Error('YOUTUBE_AUTH_REQUIRED');
  }

  try {
    const client = createYoutubeClient(tokens.access_token);
    await client.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    return { client, accessToken: tokens.access_token, quotaUsed: 1 };
  } catch (error: unknown) {
    if (error instanceof YoutubeApiError && error.code === 401 && tokens.refresh_token) {
      Logger.auth('YouTube', 'token expired, refreshing');
      try {
        const refreshed = await refreshYoutubeAccessToken(tokens.refresh_token);
        const updated = { ...tokens, ...refreshed };
        res.cookie('youtube_tokens', validateAndSerializeYouTubeTokens(updated), getSecureCookieOptions());
        Logger.auth('YouTube', 'token refreshed successfully');
        return { client: createYoutubeClient(refreshed.access_token), accessToken: refreshed.access_token, quotaUsed: 1 };
      } catch (refreshError) {
        Logger.error('Failed to refresh YouTube token', {}, refreshError);
        throw new Error('YOUTUBE_AUTH_REQUIRED', { cause: refreshError });
      }
    }
    throw new Error('YOUTUBE_AUTH_REQUIRED', { cause: error });
  }
}
