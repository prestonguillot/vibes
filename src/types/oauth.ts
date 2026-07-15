/**
 * OAuth token and authentication types
 */

/**
 * Spotify OAuth tokens stored in cookies
 */
export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * YouTube OAuth tokens stored in cookies
 * Note: YouTube uses Google OAuth which has a different token structure
 */
export interface YouTubeTokens {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date?: number;
  channel_id?: string; // YouTube channel ID (cached at auth time to avoid API calls)
}

/**
 * What resolving an access token came to. Produced by the single validate/refresh/rewrite path
 * each service owns (resolveSpotifyToken / resolveYouTubeToken), so the two callers that need it
 * - per-request token acquisition, and the connection-status check - share one implementation and
 * differ only in how they report it.
 */
export type TokenOutcome =
  /** The stored access token still works. */
  | { status: 'valid'; accessToken: string }
  /** It had expired; a refresh succeeded and the cookie was rewritten. */
  | { status: 'refreshed'; accessToken: string }
  /** Rejected as expired (401) and unrefreshable - no refresh token, or the refresh failed. */
  | { status: 'expired'; error: unknown }
  /** Anything else: quota, throttling, a 5xx, a network failure. */
  | { status: 'error'; statusCode?: number; error: unknown };
