/**
 * Integration tests for index page rendering
 * Tests HTMX event-based playlist refresh
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';

const app = createApp();

describe('Index Page', () => {
  describe('GET /', () => {
    it('should return 200 and render index page', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.text).toBeDefined();
      expect(response.text).toContain('<title>Spotify to YouTube Playlist Sync</title>');
    });

    it('should include HTMX script', async () => {
      const response = await request(app)
        .get('/');

      expect(response.text).toContain('htmx.org');
    });
  });

  describe('HTMX Event Configuration', () => {
    it('should configure playlists section to listen for youtubeConnected event', async () => {
      const response = await request(app)
        .get('/');

      // Playlists content div should have hx-trigger that listens for youtubeConnected event
      expect(response.text).toContain('id="playlists-content"');
      expect(response.text).toContain('hx-trigger="load, youtubeConnected from:body"');
    });

    it('should configure playlists section to fetch from correct endpoint', async () => {
      const response = await request(app)
        .get('/');

      // Should fetch playlists with ownOnly parameter
      expect(response.text).toContain('hx-get="/auth/spotify/playlists?ownOnly=true"');
    });

    it('should configure YouTube status to poll regularly', async () => {
      const response = await request(app)
        .get('/');

      // YouTube status should poll every 5 minutes
      expect(response.text).toContain('id="youtube-status"');
      expect(response.text).toContain('hx-get="/api/status/youtube/button"');
      expect(response.text).toContain('hx-trigger="load, every 5m"');
    });

    it('should configure Spotify status to poll regularly', async () => {
      const response = await request(app)
        .get('/');

      // Spotify status should poll every 5 minutes
      expect(response.text).toContain('id="spotify-status"');
      expect(response.text).toContain('hx-get="/api/status/spotify/button"');
      expect(response.text).toContain('hx-trigger="load, every 5m"');
    });
  });

  describe('Security Headers', () => {
    it('should include CSRF token in page', async () => {
      const response = await request(app)
        .get('/');

      // Should include CSRF token in hx-headers on body
      expect(response.text).toContain('hx-headers');
      expect(response.text).toContain('X-CSRF-Token');
    });
  });
});
