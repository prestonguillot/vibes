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
}

/**
 * Helper type for cookies that may or may not exist
 */
export type MaybeTokens<T> = T | null;

/**
 * Parse and validate Spotify tokens from cookie string
 */
export function parseSpotifyTokens(cookieValue: string | undefined): MaybeTokens<SpotifyTokens> {
  if (!cookieValue) return null;

  try {
    const tokens = JSON.parse(cookieValue);

    // Validate structure
    if (typeof tokens.accessToken === 'string' && typeof tokens.refreshToken === 'string') {
      return tokens as SpotifyTokens;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse and validate YouTube tokens from cookie string
 */
export function parseYouTubeTokens(cookieValue: string | undefined): MaybeTokens<YouTubeTokens> {
  if (!cookieValue) return null;

  try {
    const tokens = JSON.parse(cookieValue);

    // Validate structure
    if (typeof tokens.access_token === 'string' && typeof tokens.token_type === 'string') {
      return tokens as YouTubeTokens;
    }

    return null;
  } catch {
    return null;
  }
}
