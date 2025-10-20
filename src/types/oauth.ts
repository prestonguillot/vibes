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

