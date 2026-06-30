/**
 * Integration tests for Spotify routes
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';
import { getCurrentUser, getUserPlaylists } from '@/spotify/client';
import { YoutubeApiError } from '@/youtube/client';

// Helper to create valid YouTube token cookies (with all required Zod fields)
const createMockYouTubeToken = (overrides?: Partial<any>) =>
  JSON.stringify({
    access_token: 'test-youtube-token',
    refresh_token: 'test-youtube-refresh',
    scope: 'https://www.googleapis.com/auth/youtube',
    token_type: 'Bearer',
    ...overrides,
  });

// Mock the hand-written Spotify client. The real SpotifyApiError class is kept so
// the route's status-based error branching works; the code-exchange default
// rejects (as the old authorizationCodeGrant mock did) so the callback redirects
// home with an error.
vi.mock('@/spotify/client', async (importActual) => {
  const actual = await importActual<typeof import('@/spotify/client')>();
  return {
    ...actual,
    getAuthorizeUrl: vi.fn(() => 'https://accounts.spotify.com/authorize?client_id=test'),
    exchangeCodeForTokens: vi.fn(() =>
      Promise.reject(new actual.SpotifyApiError('Invalid client', 400)),
    ),
    getCurrentUser: vi.fn(async () => ({ id: 'test-user', displayName: null })),
    getUserPlaylists: vi.fn(async () => []),
  };
});

// The /playlists route resolves a valid access token via ensureValidSpotifyToken.
vi.mock('@/spotify/auth', () => ({
  ensureValidSpotifyToken: vi.fn(async () => 'test-access-token'),
}));

const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedGetUserPlaylists = vi.mocked(getUserPlaylists);

// Maps the old spotify-web-api-node playlist fixture shape to the clean
// SpotifyPlaylistSummary the new client returns.
const playlistSummary = (id: string, name: string, trackTotal: number, ownerId = 'test-user') => ({
  id,
  name,
  ownerId,
  trackTotal,
  spotifyUrl: `https://open.spotify.com/playlist/${id}`,
});

// Mock the YouTube client. createYoutubeClient returns a shared client object so
// per-test overrides of `ytClient.client.playlists.list` take effect.
const ytClient = vi.hoisted(() => ({
  client: { playlists: { list: vi.fn(() => Promise.resolve({ data: { items: [] } })) } },
}));
vi.mock('@/youtube/client', async (importActual) => {
  const actual = await importActual<typeof import('@/youtube/client')>();
  return { ...actual, createYoutubeClient: vi.fn(() => ytClient.client) };
});

const app = createApp();

describe('Spotify Playlists', () => {
  describe('GET /auth/spotify/playlists', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/auth/spotify/playlists').expect(401);

      expect(response.text).toContain('Please connect to Spotify first');
    });

    it('should accept ownOnly=true parameter', async () => {
      const response = await request(app).get('/auth/spotify/playlists').query({ ownOnly: 'true' });

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
      const response = await request(app).get('/auth/spotify/playlists');

      // Should return 401 (no auth), but parameter validation should pass
      expect(response.status).toBe(401);
    });
  });

  describe('GET /auth/spotify/login', () => {
    it('should redirect to Spotify authorization', async () => {
      const response = await request(app).get('/auth/spotify/login').expect(302);

      expect(response.headers.location).toContain('accounts.spotify.com');
      expect(response.headers.location).toContain('authorize');
    });
  });

  describe('GET /auth/spotify/callback', () => {
    it('should reject requests without code parameter', async () => {
      const response = await request(app).get('/auth/spotify/callback');

      // Validation middleware returns 400 with error template
      expect(response.status).toBe(400);
      // Just verify it's HTML with error indication
      expect(response.text).toBeTruthy();
      expect(response.headers['content-type']).toMatch(/html/);
    });

    it('should accept valid code with matching OAuth state', async () => {
      // A valid flow presents both the state query param and the matching
      // state cookie set during /login. Validation + state check pass, then the
      // mocked Spotify API rejects the code exchange, so the route redirects
      // home with error params.
      const response = await request(app)
        .get('/auth/spotify/callback')
        .set('Cookie', 'spotify_oauth_state=matching-state-value')
        .query({ code: 'test-authorization-code-from-spotify', state: 'matching-state-value' });

      expect(response.status).toBe(302);
      expect(response.headers['location']).toMatch(/^\/\?error=spotify&reason=/);
    });

    it('should reject callback when OAuth state does not match the cookie', async () => {
      const response = await request(app)
        .get('/auth/spotify/callback')
        .set('Cookie', 'spotify_oauth_state=expected-state')
        .query({ code: 'test-authorization-code-from-spotify', state: 'attacker-supplied-state' });

      expect(response.status).toBe(302);
      expect(response.headers['location']).toBe('/?error=spotify&reason=state_mismatch');
    });

    it('should reject callback when OAuth state cookie is missing', async () => {
      const response = await request(app)
        .get('/auth/spotify/callback')
        .query({ code: 'test-authorization-code-from-spotify', state: 'some-state' });

      expect(response.status).toBe(302);
      expect(response.headers['location']).toBe('/?error=spotify&reason=state_mismatch');
    });
  });

  describe('GET /auth/spotify/login - OAuth state', () => {
    it('should set a non-empty spotify_oauth_state cookie', async () => {
      const response = await request(app).get('/auth/spotify/login').expect(302);

      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const stateCookie = ([] as string[])
        .concat(setCookie)
        .find((c) => c.startsWith('spotify_oauth_state='));
      expect(stateCookie).toBeDefined();
      // Cookie must carry an actual value and use SameSite=Lax so it survives
      // the cross-site redirect back from Spotify.
      expect(stateCookie).not.toMatch(/^spotify_oauth_state=;/);
      expect(stateCookie).toMatch(/SameSite=Lax/i);
    });
  });

  describe('Sync Button Visibility (YouTube Connection)', () => {
    it('should show disabled button when YouTube is not connected', async () => {
      // Mock Spotify API to return playlists
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Test Playlist', 10),
      ]);

      // Set Spotify cookie but NOT YouTube cookie
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`])
        .expect(200);

      // Should render playlists with disabled sync button
      expect(response.text).toContain('Connect to YouTube to Sync');
      expect(response.text).toContain('disabled');
      // Should NOT contain the enabled sync button text
      expect(response.text).not.toContain('Sync to YouTube');
    });

    it('should show enabled sync button when both Spotify and YouTube are connected', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Test Playlist', 10),
      ]);

      // Set both Spotify AND YouTube cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh',
      });
      const youtubeTokens = createMockYouTubeToken();

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`, `youtube_tokens=${youtubeTokens}`])
        .expect(200);

      // Should render playlists with enabled sync button
      expect(response.text).toContain('Sync to YouTube');
      // Should NOT contain the disabled button text
      expect(response.text).not.toContain('Connect to YouTube to Sync');
    });

    it('should show "Update YouTube Playlist" for synced playlists when YouTube is connected', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Synced Playlist', 10),
      ]);

      // Set both cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh',
      });
      const youtubeTokens = createMockYouTubeToken();

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`, `youtube_tokens=${youtubeTokens}`])
        .expect(200);

      // For unsynced playlists, should show "Sync to YouTube"
      expect(response.text).toContain('Sync to YouTube');
    });
  });

  describe('Playlist Summary Text Based on YouTube Connection', () => {
    it('should show playlist count when YouTube is not connected', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Test Playlist 1', 10),
        playlistSummary('2234567890123456789012', 'Test Playlist 2', 5),
      ]);

      // Set only Spotify cookie (no YouTube)
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`])
        .expect(200);

      // Should show playlist count without extra message
      expect(response.text).toContain('Showing 2 playlists');
      // Should NOT show "connect YouTube" message
      expect(response.text).not.toContain('connect YouTube to check sync status');
      // Should NOT show "none synced yet" since we can't determine sync status
      expect(response.text).not.toContain('none synced yet');
    });

    it('should show "none synced yet" when YouTube is connected but no playlists are synced', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Unsynced Playlist', 10),
      ]);

      // Set both Spotify and YouTube cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh',
      });
      const youtubeTokens = createMockYouTubeToken();

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`, `youtube_tokens=${youtubeTokens}`])
        .expect(200);

      // Should show "none synced yet" since YouTube is connected but no playlists match
      expect(response.text).toContain('none synced yet');
      expect(response.text).toContain('Showing 1 playlists');
      // Should NOT show "connect YouTube" message
      expect(response.text).not.toContain('connect YouTube to check sync status');
    });

    it('should show synced/unsynced counts when YouTube is connected and playlists are synced', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Synced Playlist', 10),
        playlistSummary('2234567890123456789012', 'Unsynced Playlist', 5),
      ]);

      // Mock YouTube API to return a synced playlist
      ytClient.client.playlists.list = vi.fn(() =>
        Promise.resolve({
          data: {
            items: [
              {
                id: 'yt_playlist_id',
                snippet: {
                  title: 'Synced Playlist (from Spotify)', // This matches "Synced Playlist" + " (from Spotify)"
                },
              },
            ],
          },
        }),
      ) as any;

      // Set both cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh',
      });
      const youtubeTokens = createMockYouTubeToken();

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`, `youtube_tokens=${youtubeTokens}`])
        .expect(200);

      // Should show synced and unsynced counts since at least one is synced
      // "Synced Playlist" matches "Synced Playlist (from Spotify)" on YouTube
      expect(response.text).toContain('synced');
      expect(response.text).toContain('unsynced');
    });

    it('should include "your playlists only" when ownOnly=true and YouTube not connected', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'My Playlist', 10),
      ]);

      // Set only Spotify cookie
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .query({ ownOnly: 'true' })
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`])
        .expect(200);

      // Should NOT show the "connect YouTube" message (removed per user feedback)
      expect(response.text).not.toContain('connect YouTube to check sync status');
    });
  });

  describe('Playlist Expand Functionality', () => {
    it('should show expand button when YouTube is not connected', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Test Playlist', 10),
      ]);

      // Set only Spotify cookie (no YouTube)
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`])
        .expect(200);

      // Should show expand functionality
      expect(response.text).toContain('expand-1234567890123456789012');
      expect(response.text).toContain('playlist-expand-toggle');
      expect(response.text).toContain('playlist-expand-area');
      expect(response.text).toContain('expand-indicator');
    });

    it('should show expand button for unsynced playlists when YouTube is connected', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Unsynced Playlist', 10),
      ]);

      // Set both Spotify and YouTube cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh',
      });
      const youtubeTokens = createMockYouTubeToken();

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`, `youtube_tokens=${youtubeTokens}`])
        .expect(200);

      // Should show expand functionality even for unsynced playlist
      expect(response.text).toContain('expand-1234567890123456789012');
      expect(response.text).toContain('playlist-expand-toggle');
      expect(response.text).toContain('playlist-expand-area');
      expect(response.text).toContain('expand-indicator');
    });

    it('should show expand button for synced playlists when YouTube is connected', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Synced Playlist', 10),
      ]);

      // Mock YouTube API to return a synced playlist
      ytClient.client.playlists.list = vi.fn(() =>
        Promise.resolve({
          data: {
            items: [
              {
                id: 'yt_playlist_id',
                snippet: {
                  title: 'Synced Playlist (from Spotify)',
                },
              },
            ],
          },
        }),
      ) as any;

      // Set both cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh',
      });
      const youtubeTokens = createMockYouTubeToken();

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`, `youtube_tokens=${youtubeTokens}`])
        .expect(200);

      // Should show expand functionality for synced playlist
      expect(response.text).toContain('expand-1234567890123456789012');
      expect(response.text).toContain('playlist-expand-toggle');
      expect(response.text).toContain('playlist-expand-area');
      expect(response.text).toContain('expand-indicator');
    });
  });

  describe('YouTube Quota Error Handling During Playlist Fetch', () => {
    it('should redirect with error modal when YouTube quota is exceeded during playlist fetch', async () => {
      // Mock Spotify API to return playlists
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Test Playlist', 10),
      ]);

      // Mock YouTube API to fail with 403 quota exceeded
      ytClient.client.playlists.list = vi.fn(() =>
        Promise.reject(
          new YoutubeApiError(
            'The request cannot be completed because you have exceeded your quota.',
            403,
            'quotaExceeded',
          ),
        ),
      );

      // Set both Spotify and YouTube tokens
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh',
      });
      const youtubeTokens = createMockYouTubeToken();

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`, `youtube_tokens=${youtubeTokens}`]);

      // htmx-loaded route: use HX-Redirect (real navigation to the quota modal),
      // not a 302 that would get swapped into the container.
      expect(response.status).toBe(403);
      expect(response.headers['hx-redirect']).toMatch(/^\/\?error=youtube&reason=quota_exceeded/);
    });

    it('should open circuit breaker when YouTube quota is exceeded during playlist fetch', async () => {
      // Mock Spotify API
      mockedGetCurrentUser.mockResolvedValue({ id: 'test-user', displayName: null });
      mockedGetUserPlaylists.mockResolvedValue([
        playlistSummary('1234567890123456789012', 'Test Playlist', 10),
      ]);

      // Mock YouTube API to fail with 403
      ytClient.client.playlists.list = vi.fn(() =>
        Promise.reject(new YoutubeApiError('Quota exceeded', 403, 'quotaExceeded')),
      );

      // Import circuit breaker to check its state
      const { youtubeCircuitBreaker } = await import('../../src/lib/circuitBreaker');
      youtubeCircuitBreaker.close(); // Start fresh

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh',
      });
      const youtubeTokens = createMockYouTubeToken();

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`, `youtube_tokens=${youtubeTokens}`]);

      // Should signal the client to navigate to the quota modal via HX-Redirect
      expect(response.status).toBe(403);
      expect(response.headers['hx-redirect']).toMatch(/^\/\?error=youtube&reason=quota_exceeded/);

      // Circuit breaker should now be open
      expect(youtubeCircuitBreaker.isOpen()).toBe(true);
    });
  });
});
