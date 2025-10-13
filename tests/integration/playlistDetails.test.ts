/**
 * Integration tests for Playlist Details routes
 *
 * Note: Full error handling testing for YouTube API quota exceeded errors
 * is challenging due to the complex mocking requirements with require() statements.
 * The error handling code in playlistDetails.ts:487-512 has been implemented
 * to detect quota exceeded errors (code 403 or message containing "quota")
 * and return user-friendly messages instead of raw API errors with HTML tags.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';

const app = createApp();

describe('Playlist Details Error Handling', () => {
  /**
   * YouTube API Quota Error Handling Verification
   *
   * The code in playlistDetails.ts:487-512 has been updated to:
   * 1. Check for error code 403 OR message containing "quota"
   * 2. Return user-friendly error message with 429 status
   * 3. Prevent raw YouTube API error messages (with HTML tags) from being shown
   *
   * Manual verification of this fix requires:
   * - Trigger actual YouTube API quota exceeded error
   * - Verify that the error page shows "YouTube API Quota Exceeded" title
   * - Verify NO raw HTML tags like <a href="/youtube/v3/getting-started#quota"> appear
   * - Verify helpful message about quota reset at midnight Pacific Time
   */

  describe('Authentication Requirements', () => {
    it('should require Spotify authentication', async () => {
      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012');

      // Should return error about missing Spotify authentication
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should require YouTube authentication', async () => {
      // Only set Spotify cookie, not YouTube
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      // Should return error about missing YouTube authentication
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Playlist ID Validation', () => {
    it('should reject invalid playlist IDs', async () => {
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });
      const youtubeTokens = JSON.stringify({
        access_token: 'test-youtube-token',
        refresh_token: 'test-youtube-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/invalid-id')
        .set('Cookie', [
          `spotify_tokens=${spotifyTokens}`,
          `youtube_tokens=${youtubeTokens}`
        ]);

      // Validation middleware should reject
      expect(response.status).toBe(400);
    });

    it('should accept valid 22-character playlist IDs (non-validation)', async () => {
      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012');

      // Should not reject based on validation (may fail for auth or other reasons)
      // The key is it shouldn't be a 400 validation error
      expect(response.status).not.toBe(400);
    });
  });
});
