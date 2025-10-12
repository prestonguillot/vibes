/**
 * Integration tests for Spotify routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';

// Mock spotify-web-api-node
vi.mock('spotify-web-api-node', () => {
  const SpotifyWebApi = vi.fn();
  SpotifyWebApi.prototype.createAuthorizeURL = vi.fn(() => 'https://accounts.spotify.com/authorize?client_id=test');
  SpotifyWebApi.prototype.authorizationCodeGrant = vi.fn(() =>
    Promise.reject({
      statusCode: 400,
      body: { error: 'invalid_client', error_description: 'Invalid client' }
    })
  );
  SpotifyWebApi.prototype.setAccessToken = vi.fn();
  SpotifyWebApi.prototype.setRefreshToken = vi.fn();

  return { default: SpotifyWebApi };
});

const app = createApp();

describe('Spotify Playlists', () => {
  describe('GET /auth/spotify/playlists', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .get('/auth/spotify/playlists')
        .expect(401);

      expect(response.text).toContain('Please connect to Spotify first');
    });

    it('should accept ownOnly=true parameter', async () => {
      const response = await request(app)
        .get('/auth/spotify/playlists')
        .query({ ownOnly: 'true' });

      // Should return 401 (no auth), but parameter should be validated successfully
      expect(response.status).toBe(401);
    });

    it('should accept ownOnly=false parameter', async () => {
      const response = await request(app)
        .get('/auth/spotify/playlists')
        .query({ ownOnly: 'false' });

      // Should return 401 (no auth), but parameter should be validated successfully
      expect(response.status).toBe(401);
    });

    it('should reject invalid ownOnly parameter', async () => {
      const response = await request(app)
        .get('/auth/spotify/playlists')
        .query({ ownOnly: 'invalid' });

      // Validation middleware returns 400 with error template
      expect(response.status).toBe(400);
      // Just verify it's HTML with error indication
      expect(response.text).toBeTruthy();
      expect(response.headers['content-type']).toMatch(/html/);
    });

    it('should handle missing ownOnly parameter (optional)', async () => {
      const response = await request(app)
        .get('/auth/spotify/playlists');

      // Should return 401 (no auth), but parameter validation should pass
      expect(response.status).toBe(401);
    });
  });

  describe('GET /auth/spotify/login', () => {
    it('should redirect to Spotify authorization', async () => {
      const response = await request(app)
        .get('/auth/spotify/login')
        .expect(302);

      expect(response.headers.location).toContain('accounts.spotify.com');
      expect(response.headers.location).toContain('authorize');
    });
  });

  describe('GET /auth/spotify/callback', () => {
    it('should reject requests without code parameter', async () => {
      const response = await request(app)
        .get('/auth/spotify/callback');

      // Validation middleware returns 400 with error template
      expect(response.status).toBe(400);
      // Just verify it's HTML with error indication
      expect(response.text).toBeTruthy();
      expect(response.headers['content-type']).toMatch(/html/);
    });

    it('should accept valid code parameter format', async () => {
      const response = await request(app)
        .get('/auth/spotify/callback')
        .query({ code: 'test-authorization-code-from-spotify' });

      // Validation passes, but mocked Spotify API returns error
      // Route catches the error and renders oauth-error template with 200
      expect(response.status).toBe(200);
      expect(response.text).toBeTruthy();
      expect(response.headers['content-type']).toMatch(/html/);
    });
  });
});
