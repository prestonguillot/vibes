/**
 * The single YouTube token resolve/refresh/rewrite path (mirrors spotify/auth).
 *
 * A token records when it expires, so that is what decides whether it is used, refreshed, or asked
 * about. Refreshing reuses the stored refresh token, which Google doesn't re-issue, and rewrites
 * the cookie. Both callers go through resolveYouTubeToken and differ at the edges:
 * ensureValidYouTubeToken (per-request, throws, spends no quota on a live token) and
 * validateYouTubeConnection (status endpoint, probes YouTube for real, returns a ConnectionResult
 * and owns the circuit breaker).
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
  /** Quota units this cost: none for a token still live by its own clock, one if YouTube was asked. */
  quotaUsed: number;
}

/** Quota units spent asking YouTube whether a token works (channels.list = 1). */
export const YOUTUBE_VALIDATION_QUOTA = 1;

/**
 * Treat a token as spent this long before its stated expiry, so one that is valid when checked
 * cannot die between the check and the call it was checked for.
 */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Is the token still good by its own clock?
 *
 * 'unknown' is for a cookie written before an expiry was stored: there is nothing to reason from,
 * so it has to be asked about.
 */
function tokenFreshness(tokens: YouTubeTokens): 'fresh' | 'expired' | 'unknown' {
  if (typeof tokens.expiry_date !== 'number') return 'unknown';
  return Date.now() < tokens.expiry_date - EXPIRY_SKEW_MS ? 'fresh' : 'expired';
}

/**
 * Resolve a usable YouTube access token, refreshing and rewriting the cookie if needed.
 * Never throws for an API rejection - the outcome says what happened, so each caller decides
 * whether that means "reconnect", "back off", or "report an error".
 *
 * `probe` decides whether YouTube is asked about a token that its own expiry says is still good.
 * The two callers want different things from this:
 *
 * - A request about to do real work does not need it. The token knows when it dies, and whatever
 *   the request does next will surface a quota or health problem on its own. Asking first spends a
 *   unit to learn what is already in hand - and that price is why this path was left off routes
 *   that needed it, leaving them reading with tokens that had expired.
 * - The status endpoint DOES need it. Its whole job is to report whether YouTube is working for
 *   this user, and the call is how quota exhaustion and API health reach the circuit breaker. A
 *   fresh token proves nothing about either.
 */
export async function resolveYouTubeToken(
  tokens: YouTubeTokens,
  res: Response,
  { probe = false }: { probe?: boolean } = {},
): Promise<TokenOutcome> {
  const freshness = tokenFreshness(tokens);

  if (freshness === 'fresh' && !probe) {
    return { status: 'valid', accessToken: tokens.access_token, quotaUsed: 0 };
  }

  // Known dead: refreshing is the answer, and asking YouTube to confirm it is dead costs a unit to
  // be told what the token already said. A probe still wants the call - but there is no point
  // making it with a token that cannot work, so refresh first and let the caller's own request be
  // the probe.
  if (freshness === 'expired' && !probe) {
    return refreshAndStore(tokens, res);
  }

  try {
    const client = createYoutubeClient(tokens.access_token);
    await client.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    return {
      status: 'valid',
      accessToken: tokens.access_token,
      quotaUsed: YOUTUBE_VALIDATION_QUOTA,
    };
  } catch (error: unknown) {
    const statusCode = error instanceof YoutubeApiError ? error.code : undefined;

    // 401 = the access token expired/was rejected. This is ROUTINE (tokens expire hourly) and
    // recoverable by refresh - it is NOT an API-health failure, so it must never count against the
    // circuit breaker (counting it was what tripped the breaker on every expiry, then wiped valid
    // tokens and broke "Connect YouTube").
    if (statusCode !== 401) {
      return { status: 'error', statusCode, error };
    }

    return refreshAndStore(tokens, res, error);
  }
}

/**
 * Swap a dead access token for a live one and rewrite the cookie.
 *
 * `cause` is what proved it dead, when something did - there is nothing to carry when the token's
 * own expiry is what said so.
 */
async function refreshAndStore(
  tokens: YouTubeTokens,
  res: Response,
  cause?: unknown,
): Promise<TokenOutcome> {
  if (!tokens.refresh_token) {
    // Expired with no way to refresh (prompt=consent at connect prevents this going forward).
    return { status: 'expired', error: cause };
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
    return { status: 'refreshed', accessToken: refreshed.access_token, quotaUsed: 0 };
  } catch (refreshError) {
    Logger.error('Failed to refresh YouTube token', {}, refreshError);
    return { status: 'expired', error: refreshError };
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
      // What it actually cost, which is usually nothing. Reporting a flat unit here would have the
      // sync's quota summary bill the user for a call that was never made.
      quotaUsed: outcome.quotaUsed ?? 0,
    };
  }
  throw new Error('YOUTUBE_AUTH_REQUIRED', { cause: outcome.error });
}
