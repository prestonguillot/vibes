/**
 * Integration tests for index page rendering
 * Tests HTMX event-based playlist refresh
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';

const app = testServer(createApp());

describe('Index Page', () => {
  describe('GET /', () => {
    it('should return 200 and render index page', async () => {
      const response = await request(app).get('/').expect(200);

      expect(response.text).toBeDefined();
      expect(response.text).toContain('<title>Spotify to YouTube Playlist Sync</title>');
    });

    it('should include HTMX script', async () => {
      const response = await request(app).get('/');

      expect(response.text).toContain('/vendor/htmx.min.js');
    });
  });

  describe('HTMX Event Configuration', () => {
    it('should include YouTube connection refresh script', async () => {
      const response = await request(app).get('/');

      // Should include the YouTube connection refresh handler script
      expect(response.text).toContain('src="/js/youtubeConnectionRefresh.js"');
    });

    it('should configure playlists section to fetch from correct endpoint', async () => {
      const response = await request(app).get('/');

      // Fetches the playlists endpoint; the ownOnly filter flows via hx-include of
      // the #ownPlaylistsOnly checkbox (name="ownOnly"), not a hardcoded query param.
      expect(response.text).toContain('hx-get="/auth/spotify/playlists"');
      expect(response.text).toContain('hx-include="#ownPlaylistsOnly"');
      expect(response.text).toMatch(/id="ownPlaylistsOnly"[^>]*name="ownOnly"/);
    });

    it.each([['youtube'], ['spotify']])('resolves the %s status once, on load', async (service) => {
      const response = await request(app).get('/');

      expect(response.text).toContain(`id="${service}-status"`);
      expect(response.text).toContain(`hx-get="/api/status/${service}/button"`);
      expect(response.text).toContain('hx-trigger="load"');
    });

    // Each status check is a real call to Spotify and YouTube. Every operation validates and
    // refreshes its own token on demand, so a poll keeps nothing alive - it re-checks a connection
    // nobody is using, indefinitely, for as long as a tab stays open.
    it('does not poll the status endpoints', async () => {
      const response = await request(app).get('/');

      expect(response.text).not.toContain('every 5m');
      expect(response.text).not.toMatch(/hx-trigger="load,\s*every/);
    });
  });

  describe('Security Headers', () => {
    it('should include CSRF token in page', async () => {
      const response = await request(app).get('/');

      // Should include CSRF token in hx-headers on body
      expect(response.text).toContain('hx-headers');
      expect(response.text).toContain('X-CSRF-Token');
    });
  });

  describe('Playlist Controls Layout', () => {
    it('should label the playlist section', async () => {
      const response = await request(app).get('/');

      // The section is labelled by the "Your Playlists" card header
      expect(response.text).toContain('Your Playlists');
    });

    it('should include tracks per sync dropdown with all options', async () => {
      const response = await request(app).get('/');

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
      const response = await request(app).get('/');

      // Should have the toggle
      expect(response.text).toContain('id="ownPlaylistsOnly"');
      expect(response.text).toContain('Show only playlists I created');

      // Should be checked by default
      expect(response.text).toMatch(/id="ownPlaylistsOnly"[^>]*checked/);
    });

    it('should configure toggle to filter playlists via HTMX', async () => {
      const response = await request(app).get('/');

      // Verify toggle has correct HTMX attributes
      const toggleMatch = response.text.match(/id="ownPlaylistsOnly"[^>]*>/);
      expect(toggleMatch).toBeTruthy();

      // Should target playlists content
      expect(response.text).toMatch(/hx-target="#playlists-content"/);

      // Should trigger on change
      expect(response.text).toMatch(/hx-trigger="change"/);
    });

    it('should include the section controls (batch size + own-only toggle)', async () => {
      const response = await request(app).get('/');

      expect(response.text).toContain('id="syncBatchSize"');
      expect(response.text).toContain('id="ownPlaylistsOnly"');
    });

    it('should have responsive grid layout for controls', async () => {
      const response = await request(app).get('/');

      // Controls should use responsive grid with Bootstrap breakpoints
      expect(response.text).toContain('col-12 col-sm-auto');
      expect(response.text).toContain('row g-3');
    });
  });
});
