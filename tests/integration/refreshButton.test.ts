import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { testServer } from '../helpers/testServer';
import { youtubeCircuitBreaker } from '../../src/lib/circuitBreaker';

// Mock connection validation so these tests are deterministic and offline - the
// real validators hit the live Spotify/YouTube APIs (the source of CI flakiness).
const mockAuth = vi.hoisted(() => ({
  validateSpotifyConnection: vi.fn(),
  validateYouTubeConnection: vi.fn(),
}));
vi.mock('../../src/auth/authValidation', async (orig) => ({
  ...(await orig<typeof import('../../src/auth/authValidation')>()),
  validateSpotifyConnection: mockAuth.validateSpotifyConnection,
  validateYouTubeConnection: mockAuth.validateYouTubeConnection,
}));

// The status-button endpoints hold their response for MIN_DISPLAY_TIME_MS (~500ms) so the spinner
// cannot flash. Nothing here tests that hold, and serving it really cost ~500ms PER test - five of
// them, the slowest tests in the suite, and slow tests are what a mutant tips over stryker's timeout
// into a bogus "killed". Resolve the delay immediately.
vi.mock('../../src/lib/delay', () => ({ sleep: vi.fn(() => Promise.resolve()) }));

// One server for the file. Rebuilding the app per test bought nothing - it holds no state, and what
// varies between these tests is the mocked validators and the circuit breaker, both of which live
// outside it.
const app = testServer(createApp());

describe('Refresh Button Integration', () => {
  beforeEach(() => {
    youtubeCircuitBreaker.close();
    mockAuth.validateSpotifyConnection.mockResolvedValue({ connected: false });
    mockAuth.validateYouTubeConnection.mockResolvedValue({ connected: false });
  });

  describe('Connection Button Rendering', () => {
    it('should render Spotify connection button with data attributes when not connected', async () => {
      const response = await request(app).get('/api/status/spotify/button');

      expect(response.status).toBe(200);
      expect(response.text).toContain('data-service="spotify"');
      expect(response.text).toContain('data-connected="false"');
    });

    it('should render YouTube connection button with data attributes when not connected', async () => {
      const response = await request(app).get('/api/status/youtube/button');

      expect(response.status).toBe(200);
      expect(response.text).toContain('data-service="youtube"');
      expect(response.text).toContain('data-connected="false"');
    });

    it('should render connected Spotify button with data-connected="true"', async () => {
      mockAuth.validateSpotifyConnection.mockResolvedValue({ connected: true });
      const response = await request(app)
        .get('/api/status/spotify/button')
        .set('Cookie', 'spotify_tokens={"accessToken":"mock_token","refreshToken":"mock_refresh"}');

      expect(response.status).toBe(200);
      expect(response.text).toContain('data-service="spotify"');
      expect(response.text).toContain('data-connected="true"');
    });

    it('should render connected YouTube button with data-connected="true"', async () => {
      mockAuth.validateYouTubeConnection.mockResolvedValue({ connected: true });
      const response = await request(app)
        .get('/api/status/youtube/button')
        .set(
          'Cookie',
          'youtube_tokens={"access_token":"mock_token","refresh_token":"mock_refresh"}',
        );

      expect(response.status).toBe(200);
      expect(response.text).toContain('data-service="youtube"');
      expect(response.text).toContain('data-connected="true"');
    });
  });

  describe('Main Page Refresh Button', () => {
    it('should render refresh button as disabled by default', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.text).toContain('id="refresh-playlists-btn"');
      expect(response.text).toContain('disabled');
      expect(response.text).toMatch(/class="[^"]*disabled[^"]*"/);
    });

    it('should have helpful tooltip on refresh button', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.text).toContain('id="refresh-playlists-btn"');
      expect(response.text).toContain('Connect to both Spotify and YouTube');
    });
  });

  describe('Connection State Attributes', () => {
    it('should include data attributes in connection status containers', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);

      // Check that status containers exist
      expect(response.text).toContain('id="spotify-status"');
      expect(response.text).toContain('id="youtube-status"');
    });

    it('should render data-connected attribute in all connection states', async () => {
      const response = await request(app).get('/api/status/spotify/button');

      expect(response.status).toBe(200);
      expect(response.text).toContain('data-service="spotify"');
      // Should have data-connected attribute (value depends on auth state)
      expect(response.text).toMatch(/data-connected="(true|false)"/);
    });
  });

  describe('JavaScript Integration', () => {
    it('should include playlistFilter.js on main page', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.text).toContain('/js/playlistFilter.js');
    });

    it('should have refresh button with required attributes for JS handling', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);

      // Check refresh button has ID for JavaScript access
      expect(response.text).toContain('id="refresh-playlists-btn"');

      // Check it has HTMX attributes
      expect(response.text).toMatch(/hx-get="[^"]*\/auth\/spotify\/playlists/);
      expect(response.text).toContain('hx-target="#playlists-content"');
    });
  });

  describe('User Experience', () => {
    it('should prevent refresh without connections by default', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);

      // Refresh button should be disabled
      const refreshButtonMatch = response.text.match(
        /<button[^>]*id="refresh-playlists-btn"[^>]*>/,
      );

      expect(refreshButtonMatch).toBeTruthy();
      expect(refreshButtonMatch![0]).toContain('disabled');
    });

    it('should show appropriate messaging when not connected', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);

      // Should have loading message for playlists
      expect(response.text).toContain('Loading Playlists');
      expect(response.text).toContain('Fetching your Spotify playlists');
    });
  });
});
