import { Response } from 'express';
import { createYoutubeClient, refreshYoutubeAccessToken } from '../youtube/client';
import { Logger } from '../lib/logger';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { youtubeCircuitBreaker, spotifyCircuitBreaker } from '../lib/circuitBreaker';
import { getCurrentUser, refreshAccessToken, SpotifyApiError } from '../spotify/client';

/**
 * Cookie configuration for authentication tokens
 */
export function getSecureCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'strict' as const, // Strict CSRF protection
  };
}

/**
 * Connection validation result with optional error details
 */
export interface ConnectionResult {
  connected: boolean;
  error?: string; // User-friendly error message
  errorCode?: string | number; // Technical error code for logging
}

/**
 * Validates Spotify connection and attempts token refresh if needed
 * @returns {ConnectionResult} with connection status and optional error message
 */
export async function validateSpotifyConnection(
  spotifyTokens: SpotifyTokens | null,
  res: Response,
): Promise<ConnectionResult> {
  if (!spotifyTokens) {
    return { connected: false };
  }

  // Check circuit breaker before making API call
  if (!spotifyCircuitBreaker.canProceed()) {
    Logger.auth('Spotify', 'circuit breaker is OPEN, clearing tokens', {
      state: spotifyCircuitBreaker.getState(),
    });
    // Clear tokens so user sees disconnected state
    res.clearCookie('spotify_tokens');
    return {
      connected: false,
      error: 'Spotify API quota exceeded. Please try again later.',
      errorCode: 'CIRCUIT_BREAKER_OPEN',
    };
  }

  try {
    // Test with a lightweight API call
    await getCurrentUser(spotifyTokens.accessToken);
    Logger.auth('Spotify', 'connection validated');
    spotifyCircuitBreaker.recordSuccess();
    return { connected: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = error instanceof SpotifyApiError ? error.status : undefined;
    Logger.auth('Spotify', 'connection invalid', { error: errorMessage, statusCode });

    // 401 = the access token expired/was rejected - routine and refreshable, NOT an API-health
    // failure, so it must never count against the breaker. Try to refresh; a failed/absent refresh
    // falls through to the reconnect path below.
    if (statusCode === 401 && spotifyTokens.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(spotifyTokens.refreshToken);
        // Spotify may not return a new refresh token; reuse the stored one.
        const updatedTokens = {
          ...spotifyTokens,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? spotifyTokens.refreshToken,
        };
        res.cookie('spotify_tokens', JSON.stringify(updatedTokens), getSecureCookieOptions());
        spotifyCircuitBreaker.recordSuccess();
        Logger.auth('Spotify', 'token refreshed successfully');
        return { connected: true };
      } catch {
        Logger.auth('Spotify', 'failed to refresh token');
      }
    }
    if (statusCode === 401) {
      res.clearCookie('spotify_tokens');
      return {
        connected: false,
        error: 'Spotify credentials expired. Please reconnect.',
        errorCode: 401,
      };
    }

    // Rate limit / quota (429) - open the breaker so we back off until it resets.
    if (statusCode === 429) {
      spotifyCircuitBreaker.open();
      res.clearCookie('spotify_tokens');
      return {
        connected: false,
        error: 'Spotify API quota exceeded. Please try again later.',
        errorCode: 429,
      };
    }

    // Genuine API-health failure (5xx / network) - this is what the circuit breaker is for.
    spotifyCircuitBreaker.recordFailure(error);
    res.clearCookie('spotify_tokens');
    return {
      connected: false,
      error: 'Unable to validate Spotify connection. Please try reconnecting.',
      errorCode: statusCode,
    };
  }
}

/**
 * Validates YouTube connection and attempts token refresh if needed
 * @returns {ConnectionResult} with connection status and optional error message
 */
export async function validateYouTubeConnection(
  youtubeTokens: YouTubeTokens | null,
  res: Response,
): Promise<ConnectionResult> {
  if (!youtubeTokens) {
    return { connected: false };
  }

  // Check circuit breaker before making API call
  if (!youtubeCircuitBreaker.canProceed()) {
    Logger.auth('YouTube', 'circuit breaker is OPEN, clearing tokens', {
      state: youtubeCircuitBreaker.getState(),
    });
    // Clear tokens so user sees disconnected state
    res.clearCookie('youtube_tokens');
    return {
      connected: false,
      error: 'YouTube API quota exceeded. Please try again later.',
      errorCode: 'CIRCUIT_BREAKER_OPEN',
    };
  }

  try {
    const youtube = createYoutubeClient(youtubeTokens.access_token);

    // Test with a lightweight API call
    await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    Logger.auth('YouTube', 'connection validated');
    youtubeCircuitBreaker.recordSuccess();
    return { connected: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as { code?: number }).code;
    Logger.auth('YouTube', 'connection invalid', { error: errorMessage, code: errorCode });

    // 401 = the access token expired/was rejected. This is ROUTINE (tokens expire hourly) and
    // recoverable by refresh - it is NOT an API-health failure, so it must never count against the
    // circuit breaker (counting it was what tripped the breaker on every expiry, then wiped valid
    // tokens and broke "Connect YouTube"). Try to refresh; a failed/absent refresh falls through to
    // the reconnect path below.
    if (errorCode === 401 && youtubeTokens.refresh_token) {
      try {
        const refreshed = await refreshYoutubeAccessToken(youtubeTokens.refresh_token);
        const updatedTokens = { ...youtubeTokens, ...refreshed };
        res.cookie('youtube_tokens', JSON.stringify(updatedTokens), getSecureCookieOptions());
        youtubeCircuitBreaker.recordSuccess();
        Logger.auth('YouTube', 'token refreshed successfully');
        return { connected: true };
      } catch {
        Logger.auth('YouTube', 'failed to refresh token');
      }
    }
    if (errorCode === 401) {
      // Expired with no way to refresh (prompt=consent at connect prevents this going forward).
      res.clearCookie('youtube_tokens');
      return {
        connected: false,
        error: 'YouTube credentials expired. Please reconnect.',
        errorCode: 401,
      };
    }

    // Quota (403) - open the breaker so we stop hammering YouTube until it resets.
    if (errorCode === 403) {
      youtubeCircuitBreaker.open();
      res.clearCookie('youtube_tokens');
      return {
        connected: false,
        error: 'YouTube API quota exceeded. Please try again later.',
        errorCode: 403,
      };
    }

    // Genuine API-health failure (5xx / network) - this is what the circuit breaker is for.
    youtubeCircuitBreaker.recordFailure(error);
    res.clearCookie('youtube_tokens');
    return {
      connected: false,
      error: 'Unable to validate YouTube connection. Please try reconnecting.',
      errorCode: errorCode,
    };
  }
}
