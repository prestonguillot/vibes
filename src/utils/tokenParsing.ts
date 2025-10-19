/**
 * Safe token parsing utilities with validation
 * Prevents JSON.parse injection attacks and handles malformed data gracefully
 */

import { Logger } from './logger';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { z } from 'zod';

// Schema for Spotify tokens
const SpotifyTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1)
});

// Schema for YouTube tokens
const YouTubeTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expiry_date: z.number().optional(),
  token_type: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional()
});

/**
 * Safely parse Spotify tokens from cookie string
 * @param cookieValue - Raw cookie value to parse
 * @returns Parsed SpotifyTokens or null if invalid
 */
export function parseSpotifyTokens(cookieValue: string | undefined): SpotifyTokens | null {
  if (!cookieValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(cookieValue);
    const validated = SpotifyTokensSchema.parse(parsed);
    return validated as SpotifyTokens;
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      Logger.warn('Invalid Spotify token structure in cookie', {
        validationErrors: (error as z.ZodError).errors?.map(e => `${e.path.join('.')}: ${e.message}`) || ['Unknown validation error']
      });
    } else if (error instanceof SyntaxError) {
      Logger.warn('Malformed Spotify token JSON in cookie', {
        error: (error as SyntaxError).message
      });
    } else {
      Logger.warn('Error parsing Spotify tokens from cookie', {
        error: error instanceof Error ? (error as Error).message : 'Unknown error'
      });
    }
    return null;
  }
}

/**
 * Safely parse YouTube tokens from cookie string
 * @param cookieValue - Raw cookie value to parse
 * @returns Parsed YouTubeTokens or null if invalid
 */
export function parseYouTubeTokens(cookieValue: string | undefined): YouTubeTokens | null {
  if (!cookieValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(cookieValue);
    const validated = YouTubeTokensSchema.parse(parsed);
    return validated as YouTubeTokens;
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      Logger.warn('Invalid YouTube token structure in cookie', {
        validationErrors: (error as z.ZodError).errors?.map(e => `${e.path.join('.')}: ${e.message}`) || ['Unknown validation error']
      });
    } else if (error instanceof SyntaxError) {
      Logger.warn('Malformed YouTube token JSON in cookie', {
        error: (error as SyntaxError).message
      });
    } else {
      Logger.warn('Error parsing YouTube tokens from cookie', {
        error: error instanceof Error ? (error as Error).message : 'Unknown error'
      });
    }
    return null;
  }
}
