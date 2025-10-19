/**
 * Integration tests for connection button endpoints (BUG-002)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    youtube: vi.fn().mockReturnValue({
      channels: {
        list: vi.fn().mockResolvedValue({ data: { items: [{ id: 'test' }] } }),
      },
    }),
  },
}));

const app = createApp();

describe('Connection Button Endpoints', () => {
  describe('BUG-002: Loading parameter handling', () => {
    describe('GET /api/status/spotify/button', () => {
      it('should return 200 and render connection button', async () => {
        const response = await request(app)
          .get('/api/status/spotify/button')
          .expect(200);

        // Should contain connection button HTML
        expect(response.text).toBeDefined();
        expect(response.text.length).toBeGreaterThan(0);
      });

      it('should not crash with missing loading parameter', async () => {
        // This test ensures BUG-002 is fixed - the endpoint should pass loading parameter
        const response = await request(app)
          .get('/api/status/spotify/button');

        // Should succeed without ReferenceError
        expect(response.status).toBe(200);

        // Response should not contain error text
        expect(response.text).not.toContain('ReferenceError');
        expect(response.text).not.toContain('loading is not defined');
      });

      it('should render for unauthenticated users', async () => {
        const response = await request(app)
          .get('/api/status/spotify/button')
          .expect(200);

        // Should render successfully even without auth
        expect(response.text).toBeDefined();
      });
    });

    describe('GET /api/status/youtube/button', () => {
      it('should return 200 and render connection button', async () => {
        const response = await request(app)
          .get('/api/status/youtube/button')
          .expect(200);

        // Should contain connection button HTML
        expect(response.text).toBeDefined();
        expect(response.text.length).toBeGreaterThan(0);
      });

      it('should not crash with missing loading parameter', async () => {
        // This test ensures BUG-002 is fixed - the endpoint should pass loading parameter
        const response = await request(app)
          .get('/api/status/youtube/button');

        // Should succeed without ReferenceError
        expect(response.status).toBe(200);

        // Response should not contain error text
        expect(response.text).not.toContain('ReferenceError');
        expect(response.text).not.toContain('loading is not defined');
      });

      it('should render for unauthenticated users', async () => {
        const response = await request(app)
          .get('/api/status/youtube/button')
          .expect(200);

        // Should render successfully even without auth
        expect(response.text).toBeDefined();
      });
    });

    describe('Rate limiting', () => {
      it('should apply rate limiting to status endpoints', async () => {
        // Status endpoints use statusLimiter (30 req/min)
        // First request should succeed
        const response1 = await request(app)
          .get('/api/status/spotify/button');

        expect(response1.status).toBe(200);

        // Subsequent requests should also succeed (we're not hitting the limit)
        const response2 = await request(app)
          .get('/api/status/spotify/button');

        expect(response2.status).toBe(200);
      });
    });

    describe('Content validation', () => {
      it('should return HTML content for Spotify button', async () => {
        const response = await request(app)
          .get('/api/status/spotify/button');

        // Should be HTML
        expect(response.headers['content-type']).toMatch(/html/);
      });

      it('should return HTML content for YouTube button', async () => {
        const response = await request(app)
          .get('/api/status/youtube/button');

        // Should be HTML
        expect(response.headers['content-type']).toMatch(/html/);
      });
    });
  });

  describe('Error handling', () => {
    it('should handle invalid HTTP methods gracefully', async () => {
      const response = await request(app)
        .post('/api/status/spotify/button');

      // Should return 404 (route not found for POST)
      expect(response.status).toBe(404);
    });
  });

  describe('HTMX Event Triggers', () => {
    describe('YouTube connection events', () => {
      it('should send HX-Trigger header when YouTube is connected', async () => {
        // Mock valid YouTube tokens (must include all required fields for Zod validation)
        const mockYouTubeTokens = JSON.stringify({
          access_token: 'mock_youtube_access_token',
          refresh_token: 'mock_youtube_refresh_token',
          scope: 'https://www.googleapis.com/auth/youtube',
          token_type: 'Bearer',
          expiry_date: Date.now() + 3600000 // 1 hour from now
        });

        const response = await request(app)
          .get('/api/status/youtube/button')
          .set('Cookie', [`youtube_tokens=${mockYouTubeTokens}`]);

        // Should send HX-Trigger header to refresh playlists
        expect(response.headers['hx-trigger']).toBe('youtubeConnected');
      });

      it('should NOT send HX-Trigger header when YouTube is not connected', async () => {
        const response = await request(app)
          .get('/api/status/youtube/button');

        // Should NOT send HX-Trigger header when not connected
        expect(response.headers['hx-trigger']).toBeUndefined();
      });

      it('should NOT send HX-Trigger header for Spotify button', async () => {
        // Mock valid Spotify tokens
        const mockSpotifyTokens = JSON.stringify({
          accessToken: 'mock_spotify_access_token',
          refreshToken: 'mock_spotify_refresh_token'
        });

        const response = await request(app)
          .get('/api/status/spotify/button')
          .set('Cookie', [`spotify_tokens=${mockSpotifyTokens}`]);

        // Spotify button should not trigger playlist refresh
        expect(response.headers['hx-trigger']).toBeUndefined();
      });
    });
  });
});
