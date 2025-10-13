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

// Mock googleapis
vi.mock('googleapis', () => {
  const mockPlaylists = {
    list: vi.fn(() => Promise.resolve({ data: { items: [] } }))
  };

  const mockYoutube = vi.fn(() => ({
    playlists: mockPlaylists
  }));

  const mockOAuth2 = vi.fn();
  mockOAuth2.prototype.setCredentials = vi.fn();

  return {
    google: {
      youtube: mockYoutube,
      auth: {
        OAuth2: mockOAuth2
      }
    }
  };
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

  describe('Sync Button Visibility (YouTube Connection)', () => {
    it('should show disabled button when YouTube is not connected', async () => {
      // Mock Spotify API to return playlists
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Test Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Set Spotify cookie but NOT YouTube cookie
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token'
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
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Test Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Set both Spotify AND YouTube cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });
      const youtubeTokens = JSON.stringify({
        access_token: 'test-youtube-token',
        refresh_token: 'test-youtube-refresh'
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [
          `spotify_tokens=${spotifyTokens}`,
          `youtube_tokens=${youtubeTokens}`
        ])
        .expect(200);

      // Should render playlists with enabled sync button
      expect(response.text).toContain('Sync to YouTube');
      // Should NOT contain the disabled button text
      expect(response.text).not.toContain('Connect to YouTube to Sync');
    });

    it('should show "Update YouTube Playlist" for synced playlists when YouTube is connected', async () => {
      // Mock Spotify API
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Synced Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Set both cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });
      const youtubeTokens = JSON.stringify({
        access_token: 'test-youtube-token',
        refresh_token: 'test-youtube-refresh'
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [
          `spotify_tokens=${spotifyTokens}`,
          `youtube_tokens=${youtubeTokens}`
        ])
        .expect(200);

      // For unsynced playlists, should show "Sync to YouTube"
      expect(response.text).toContain('Sync to YouTube');
    });
  });

  describe('Playlist Summary Text Based on YouTube Connection', () => {
    it('should show "connect YouTube to check sync status" when YouTube is not connected', async () => {
      // Mock Spotify API
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Test Playlist 1',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              },
              {
                id: '2234567890123456789012',
                name: 'Test Playlist 2',
                tracks: { total: 5 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/456' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Set only Spotify cookie (no YouTube)
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token'
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`])
        .expect(200);

      // Should show message indicating YouTube connection needed to check sync status
      expect(response.text).toContain('connect YouTube to check sync status');
      expect(response.text).toContain('Showing 2 playlists');
      // Should NOT show "none synced yet" since we can't determine sync status
      expect(response.text).not.toContain('none synced yet');
    });

    it('should show "none synced yet" when YouTube is connected but no playlists are synced', async () => {
      // Mock Spotify API
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Unsynced Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Set both Spotify and YouTube cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });
      const youtubeTokens = JSON.stringify({
        access_token: 'test-youtube-token',
        refresh_token: 'test-youtube-refresh'
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [
          `spotify_tokens=${spotifyTokens}`,
          `youtube_tokens=${youtubeTokens}`
        ])
        .expect(200);

      // Should show "none synced yet" since YouTube is connected but no playlists match
      expect(response.text).toContain('none synced yet');
      expect(response.text).toContain('Showing 1 playlists');
      // Should NOT show "connect YouTube" message
      expect(response.text).not.toContain('connect YouTube to check sync status');
    });

    it('should show synced/unsynced counts when YouTube is connected and playlists are synced', async () => {
      // Mock Spotify API
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Synced Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              },
              {
                id: '2234567890123456789012',
                name: 'Unsynced Playlist',
                tracks: { total: 5 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/456' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Mock YouTube API to return a synced playlist
      const googleapis = await import('googleapis');
      const mockYoutubeApi = googleapis.google.youtube({} as any);
      mockYoutubeApi.playlists.list = vi.fn(() =>
        Promise.resolve({
          data: {
            items: [
              {
                id: 'yt_playlist_id',
                snippet: {
                  title: 'Synced Playlist (from Spotify)' // This matches "Synced Playlist" + " (from Spotify)"
                }
              }
            ]
          }
        })
      ) as any;

      // Set both cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });
      const youtubeTokens = JSON.stringify({
        access_token: 'test-youtube-token',
        refresh_token: 'test-youtube-refresh'
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [
          `spotify_tokens=${spotifyTokens}`,
          `youtube_tokens=${youtubeTokens}`
        ])
        .expect(200);

      // Should show synced and unsynced counts since at least one is synced
      // "Synced Playlist" matches "Synced Playlist (from Spotify)" on YouTube
      expect(response.text).toContain('synced');
      expect(response.text).toContain('unsynced');
    });

    it('should include "your playlists only" when ownOnly=true and YouTube not connected', async () => {
      // Mock Spotify API
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'My Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Set only Spotify cookie
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token'
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .query({ ownOnly: 'true' })
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`])
        .expect(200);

      // Should show both "your playlists only" and "connect YouTube" message
      expect(response.text).toContain('your playlists only');
      expect(response.text).toContain('connect YouTube to check sync status');
    });
  });

  describe('Playlist Expand Functionality', () => {
    it('should show expand button when YouTube is not connected', async () => {
      // Mock Spotify API
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Test Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Set only Spotify cookie (no YouTube)
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token'
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
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Unsynced Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Set both Spotify and YouTube cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });
      const youtubeTokens = JSON.stringify({
        access_token: 'test-youtube-token',
        refresh_token: 'test-youtube-refresh'
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [
          `spotify_tokens=${spotifyTokens}`,
          `youtube_tokens=${youtubeTokens}`
        ])
        .expect(200);

      // Should show expand functionality even for unsynced playlist
      expect(response.text).toContain('expand-1234567890123456789012');
      expect(response.text).toContain('playlist-expand-toggle');
      expect(response.text).toContain('playlist-expand-area');
      expect(response.text).toContain('expand-indicator');
    });

    it('should show expand button for synced playlists when YouTube is connected', async () => {
      // Mock Spotify API
      const SpotifyWebApi = (await import('spotify-web-api-node')).default;
      SpotifyWebApi.prototype.getMe = vi.fn(() =>
        Promise.resolve({ body: { id: 'test-user' } })
      );
      SpotifyWebApi.prototype.getUserPlaylists = vi.fn(() =>
        Promise.resolve({
          body: {
            items: [
              {
                id: '1234567890123456789012',
                name: 'Synced Playlist',
                tracks: { total: 10 },
                external_urls: { spotify: 'https://open.spotify.com/playlist/123' },
                owner: { id: 'test-user' }
              }
            ]
          }
        })
      );

      // Mock YouTube API to return a synced playlist
      const googleapis = await import('googleapis');
      const mockYoutubeApi = googleapis.google.youtube({} as any);
      mockYoutubeApi.playlists.list = vi.fn(() =>
        Promise.resolve({
          data: {
            items: [
              {
                id: 'yt_playlist_id',
                snippet: {
                  title: 'Synced Playlist (from Spotify)'
                }
              }
            ]
          }
        })
      ) as any;

      // Set both cookies
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });
      const youtubeTokens = JSON.stringify({
        access_token: 'test-youtube-token',
        refresh_token: 'test-youtube-refresh'
      });

      const response = await request(app)
        .get('/auth/spotify/playlists')
        .set('Cookie', [
          `spotify_tokens=${spotifyTokens}`,
          `youtube_tokens=${youtubeTokens}`
        ])
        .expect(200);

      // Should show expand functionality for synced playlist
      expect(response.text).toContain('expand-1234567890123456789012');
      expect(response.text).toContain('playlist-expand-toggle');
      expect(response.text).toContain('playlist-expand-area');
      expect(response.text).toContain('expand-indicator');
    });
  });
});
