/**
 * The single YouTube token validate/refresh/rewrite path (mirrors spotify/auth).
 *
 * Validates an access token with a lightweight channels.list; on 401 it refreshes (reusing the
 * stored refresh token, which Google doesn't re-issue), rewrites the cookie, and reports what
 * happened. Both callers go through resolveYouTubeToken and differ only at the edges:
 * ensureValidYouTubeToken (per-request, throws) and validateYouTubeConnection (status endpoint,
 * returns a ConnectionResult and owns the circuit breaker).
 */

import { Request, Response } from 'express';
import {
  createYoutubeClient,
  refreshYoutubeAccessToken,
  YoutubeApiError,
  YoutubeClient,
} from './client';
import {
  getSecureCookieOptions,
  parseYouTubeTokenCookie,
  validateAndSerializeYouTubeTokens,
} from '../auth/cookieParser';
import { TokenOutcome, YouTubeTokens } from '../types/oauth';
import { Logger } from '../lib/logger';

export interface ValidYouTube {
  client: YoutubeClient;
  accessToken: string;
  /** Quota units spent validating (channels.list = 1). */
  quotaUsed: number;
}

/** Quota units spent validating a token (channels.list = 1). */
export const YOUTUBE_VALIDATION_QUOTA = 1;

/**
 * Resolve a usable YouTube access token, refreshing and rewriting the cookie if needed.
 * Never throws for an API rejection - the outcome says what happened, so each caller decides
 * whether that means "reconnect", "back off", or "report an error".
 */
export async function resolveYouTubeToken(
  tokens: YouTubeTokens,
  res: Response,
): Promise<TokenOutcome> {
  try {
    const client = createYoutubeClient(tokens.access_token);
    await client.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    return { status: 'valid', accessToken: tokens.access_token };
  } catch (error: unknown) {
    const statusCode = error instanceof YoutubeApiError ? error.code : undefined;

    // 401 = the access token expired/was rejected. This is ROUTINE (tokens expire hourly) and
    // recoverable by refresh - it is NOT an API-health failure, so it must never count against the
    // circuit breaker (counting it was what tripped the breaker on every expiry, then wiped valid
    // tokens and broke "Connect YouTube").
    if (statusCode !== 401) {
      return { status: 'error', statusCode, error };
    }

    if (!tokens.refresh_token) {
      // Expired with no way to refresh (prompt=consent at connect prevents this going forward).
      return { status: 'expired', error };
    }

    Logger.auth('YouTube', 'token expired, refreshing');
    try {
      const refreshed = await refreshYoutubeAccessToken(tokens.refresh_token);
      const updated = { ...tokens, ...refreshed };
      // Validate before storing: a cookie written straight from a refresh response is exactly
      // where a malformed token would otherwise be persisted unnoticed.
      res.cookie(
        'youtube_tokens',
        validateAndSerializeYouTubeTokens(updated),
        getSecureCookieOptions(),
      );
      Logger.auth('YouTube', 'token refreshed successfully');
      return { status: 'refreshed', accessToken: refreshed.access_token };
    } catch (refreshError) {
      Logger.error('Failed to refresh YouTube token', {}, refreshError);
      return { status: 'expired', error: refreshError };
    }
  }
}

/**
 * A client bound to a valid access token for this request, refreshing it if needed.
 * Throws Error('YOUTUBE_AUTH_REQUIRED') when the user must reconnect.
 */
export async function ensureValidYouTubeToken(req: Request, res: Response): Promise<ValidYouTube> {
  const tokens = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);
  if (!tokens) {
    throw new Error('YOUTUBE_AUTH_REQUIRED');
  }

  const outcome = await resolveYouTubeToken(tokens, res);
  if (outcome.status === 'valid' || outcome.status === 'refreshed') {
    return {
      client: createYoutubeClient(outcome.accessToken),
      accessToken: outcome.accessToken,
      quotaUsed: YOUTUBE_VALIDATION_QUOTA,
    };
  }
  throw new Error('YOUTUBE_AUTH_REQUIRED', { cause: outcome.error });
}
