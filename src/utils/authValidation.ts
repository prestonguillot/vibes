import { Response } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';
import { Logger } from './logger';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { youtubeCircuitBreaker } from './circuitBreaker';

/**
 * Cookie configuration for authentication tokens
 */
export function getSecureCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'strict' as const // Strict CSRF protection
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
  res: Response
): Promise<ConnectionResult> {
  if (!spotifyTokens) {
    return { connected: false };
  }

  try {
    const spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI
    });

    spotifyApi.setAccessToken(spotifyTokens.accessToken);
    spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

    // Test with a lightweight API call
    await spotifyApi.getMe();
    Logger.auth('Spotify', 'connection validated');
    return { connected: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = (error as { statusCode?: number }).statusCode;
    Logger.auth('Spotify', 'connection invalid', { error: errorMessage, statusCode });

    // Try to refresh the token on 401
    if (statusCode === 401 && spotifyTokens.refreshToken) {
      try {
        const spotifyApi = new SpotifyWebApi({
          clientId: process.env.SPOTIFY_CLIENT_ID,
          clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
          redirectUri: process.env.SPOTIFY_REDIRECT_URI
        });

        spotifyApi.setAccessToken(spotifyTokens.accessToken);
        spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

        const data = await spotifyApi.refreshAccessToken();
        const { access_token } = data.body;

        // Update cookie with new token
        const updatedTokens = { ...spotifyTokens, accessToken: access_token };
        res.cookie('spotify_tokens', JSON.stringify(updatedTokens), getSecureCookieOptions());

        Logger.auth('Spotify', 'token refreshed successfully');
        return { connected: true };
      } catch (refreshError) {
        Logger.auth('Spotify', 'failed to refresh token');
        res.clearCookie('spotify_tokens');
        return {
          connected: false,
          error: 'Spotify credentials expired. Please reconnect.',
          errorCode: 401
        };
      }
    } else {
      // Clear invalid tokens
      res.clearCookie('spotify_tokens');
      return {
        connected: false,
        error: 'Unable to validate Spotify connection. Please try reconnecting.',
        errorCode: statusCode
      };
    }
  }
}

/**
 * Validates YouTube connection and attempts token refresh if needed
 * @returns {ConnectionResult} with connection status and optional error message
 */
export async function validateYouTubeConnection(
  youtubeTokens: YouTubeTokens | null,
  res: Response
): Promise<ConnectionResult> {
  if (!youtubeTokens) {
    return { connected: false };
  }

  // Check circuit breaker before making API call
  if (!youtubeCircuitBreaker.canProceed()) {
    Logger.auth('YouTube', 'circuit breaker is OPEN, clearing tokens', {
      state: youtubeCircuitBreaker.getState()
    });
    // Clear tokens so user sees disconnected state
    res.clearCookie('youtube_tokens');
    return {
      connected: false,
      error: 'YouTube API quota exceeded. Please try again later.',
      errorCode: 'CIRCUIT_BREAKER_OPEN'
    };
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT_URI
    );

    oauth2Client.setCredentials(youtubeTokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Test with a lightweight API call
    await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    Logger.auth('YouTube', 'connection validated');
    youtubeCircuitBreaker.recordSuccess();
    return { connected: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as { code?: number }).code;
    Logger.auth('YouTube', 'connection invalid', { error: errorMessage, code: errorCode });

    // Quota exceeded - open circuit breaker and clear tokens
    if (errorCode === 403) {
      youtubeCircuitBreaker.open();
      // Clear tokens so user sees disconnected state
      res.clearCookie('youtube_tokens');
      return {
        connected: false,
        error: 'YouTube API quota exceeded. Please try again later.',
        errorCode: 403
      };
    } else {
      youtubeCircuitBreaker.recordFailure(error);
    }

    // Try to refresh the token on 401
    if (errorCode === 401 && youtubeTokens.refresh_token) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.YOUTUBE_CLIENT_ID,
          process.env.YOUTUBE_CLIENT_SECRET,
          process.env.YOUTUBE_REDIRECT_URI
        );

        oauth2Client.setCredentials(youtubeTokens);
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Update cookie with new tokens
        const updatedTokens = { ...youtubeTokens, ...credentials };
        res.cookie('youtube_tokens', JSON.stringify(updatedTokens), getSecureCookieOptions());

        Logger.auth('YouTube', 'token refreshed successfully');
        return { connected: true };
      } catch (refreshError) {
        Logger.auth('YouTube', 'failed to refresh token');
        res.clearCookie('youtube_tokens');
        return {
          connected: false,
          error: 'YouTube credentials expired. Please reconnect.',
          errorCode: 401
        };
      }
    } else {
      res.clearCookie('youtube_tokens');
      return {
        connected: false,
        error: 'Unable to validate YouTube connection. Please try reconnecting.',
        errorCode: errorCode
      };
    }
  }
}
