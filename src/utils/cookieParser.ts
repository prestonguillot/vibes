import { Response } from 'express';
import { z } from 'zod';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { Logger } from './logger';

/**
 * Zod schemas for validating OAuth tokens
 */
export const SpotifyTokensSchema = z.object({
  accessToken: z.string().min(1, 'Access token must not be empty'),
  refreshToken: z.string().min(1, 'Refresh token must not be empty')
});

export const YouTubeTokensSchema = z.object({
  access_token: z.string().min(1, 'Access token must not be empty'),
  refresh_token: z.string().optional(),
  scope: z.string().min(1, 'Scope must not be empty'),
  token_type: z.string().min(1, 'Token type must not be empty'),
  expiry_date: z.number().optional()
});

/**
 * Safely parse Spotify token from cookie
 * - Validates JSON parsing
 * - Validates against schema
 * - Clears cookie on failure
 * - Logs warnings for suspicious activity
 */
export function parseSpotifyTokenCookie(
  cookieValue: string | undefined,
  res?: Response
): SpotifyTokens | null {
  if (!cookieValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(cookieValue);
    const validated = SpotifyTokensSchema.parse(parsed);
    return validated;
  } catch (error) {
    Logger.warn('Failed to parse Spotify token cookie - possible malicious activity', {
      error: error instanceof Error ? error.message : 'Unknown error',
      cookiePresent: !!cookieValue
    });

    // Clear the corrupted cookie
    if (res) {
      res.clearCookie('spotify_tokens');
    }

    return null;
  }
}

/**
 * Safely parse YouTube token from cookie
 * - Validates JSON parsing
 * - Validates against schema
 * - Clears cookie on failure
 * - Logs warnings for suspicious activity
 */
export function parseYouTubeTokenCookie(
  cookieValue: string | undefined,
  res?: Response
): YouTubeTokens | null {
  if (!cookieValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(cookieValue);
    const validated = YouTubeTokensSchema.parse(parsed);
    return validated;
  } catch (error) {
    Logger.warn('Failed to parse YouTube token cookie - possible malicious activity', {
      error: error instanceof Error ? error.message : 'Unknown error',
      cookiePresent: !!cookieValue
    });

    // Clear the corrupted cookie
    if (res) {
      res.clearCookie('youtube_tokens');
    }

    return null;
  }
}
