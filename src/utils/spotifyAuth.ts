/**
 * Shared Spotify token validation/refresh for request handlers.
 *
 * Replaces the copies that previously lived in sync.ts, spotify.ts and
 * playlistDetails.ts. Validates the cookie's access token with a lightweight
 * /me call; on 401 it refreshes (reusing the stored refresh token when Spotify
 * doesn't return a new one), rewrites the cookie, and returns the valid token.
 * Throws Error('SPOTIFY_AUTH_REQUIRED') when the user must reconnect.
 */

import { Request, Response } from 'express';
import { getCurrentUser, refreshAccessToken, SpotifyApiError } from './spotifyClient';
import { parseSpotifyTokenCookie, validateAndSerializeSpotifyTokens } from './cookieParser';
import { getSecureCookieOptions } from './authValidation';
import { Logger } from './logger';

export async function ensureValidSpotifyToken(req: Request, res: Response): Promise<string> {
  const tokens = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);
  if (!tokens) {
    throw new Error('SPOTIFY_AUTH_REQUIRED');
  }

  try {
    await getCurrentUser(tokens.accessToken);
    return tokens.accessToken;
  } catch (error: unknown) {
    if (error instanceof SpotifyApiError && error.status === 401 && tokens.refreshToken) {
      Logger.auth('Spotify', 'token expired, refreshing');
      try {
        const refreshed = await refreshAccessToken(tokens.refreshToken);
        const updated = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? tokens.refreshToken
        };
        res.cookie('spotify_tokens', validateAndSerializeSpotifyTokens(updated), getSecureCookieOptions());
        Logger.auth('Spotify', 'token refreshed successfully');
        return updated.accessToken;
      } catch (refreshError) {
        Logger.error('Failed to refresh Spotify token', {}, refreshError);
        throw new Error('SPOTIFY_AUTH_REQUIRED', { cause: refreshError });
      }
    }
    throw new Error('SPOTIFY_AUTH_REQUIRED', { cause: error });
  }
}
