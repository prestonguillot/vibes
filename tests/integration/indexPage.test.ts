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
    it('should include YouTube connection refresh script', async () => {
      const response = await request(app)
        .get('/');

      // Should include the YouTube connection refresh handler script
      expect(response.text).toContain('src="/js/youtubeConnectionRefresh.js"');
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

  describe('Playlist Controls Layout', () => {
    it('should include playlist section heading', async () => {
      const response = await request(app)
        .get('/');

      expect(response.text).toContain('Your Spotify Playlists');
    });

    it('should include tracks per sync dropdown with all options', async () => {
      const response = await request(app)
        .get('/');

      // Should have the dropdown
      expect(response.text).toContain('id="syncBatchSize"');
      expect(response.text).toContain('Tracks per sync:');

      // Should have all options with "all" as default
      expect(response.text).toContain('<option value="10">10</option>');
      expect(response.text).toContain('<option value="25">25</option>');
      expect(response.text).toContain('<option value="50">50</option>');
      expect(response.text).toContain('<option value="100">100</option>');
      expect(response.text).toContain('<option value="all" selected>All</option>');
    });

    it('should include "Show only playlists I created" toggle checked by default', async () => {
      const response = await request(app)
        .get('/');

      // Should have the toggle
      expect(response.text).toContain('id="ownPlaylistsOnly"');
      expect(response.text).toContain('Show only playlists I created');

      // Should be checked by default
      expect(response.text).toMatch(/id="ownPlaylistsOnly"[^>]*checked/);
    });

    it('should configure toggle to filter playlists via HTMX', async () => {
      const response = await request(app)
        .get('/');

      // Verify toggle has correct HTMX attributes
      const toggleMatch = response.text.match(/id="ownPlaylistsOnly"[^>]*>/);
      expect(toggleMatch).toBeTruthy();

      // Should target playlists content
      expect(response.text).toMatch(/hx-target="#playlists-content"/);

      // Should trigger on change
      expect(response.text).toMatch(/hx-trigger="change"/);
    });

    it('should have heading and controls in separate structure for better spacing', async () => {
      const response = await request(app)
        .get('/');

      // Should have proper spacing class on heading
      expect(response.text).toMatch(/<h4[^>]*class="[^"]*mb-3[^"]*">Your Spotify Playlists<\/h4>/);

      // Verify heading and controls are present in the same section
      expect(response.text).toContain('Your Spotify Playlists');
      expect(response.text).toContain('id="syncBatchSize"');
      expect(response.text).toContain('id="ownPlaylistsOnly"');
    });

    it('should have responsive grid layout for controls', async () => {
      const response = await request(app)
        .get('/');

      // Controls should use responsive grid with Bootstrap breakpoints
      expect(response.text).toContain('col-12 col-sm-auto');
      expect(response.text).toContain('row g-3');
    });
  });
});
