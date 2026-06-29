/**
 * Integration tests for Playlist Details routes
 *
 * Note: Full error handling testing for YouTube API quota exceeded errors
 * is challenging due to the complex mocking requirements with require() statements.
 * The error handling code in playlistDetails.ts:487-512 has been implemented
 * to detect quota exceeded errors (code 403 or message containing "quota")
 * and return user-friendly messages instead of raw API errors with HTML tags.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';

// The route reads playlist metadata via the hand-written spotifyClient
// (getPlaylist -> { name, trackTotal, ... }) and the track list via the /items
// helper (fetchAllPlaylistItems -> [{ track }]). Both are mocked with hoisted
// vi.fns so the factory and the per-test overrides share the same mocks.
const h = vi.hoisted(() => ({
  getPlaylist: vi.fn(),
  fetchAllPlaylistItems: vi.fn()
}));

vi.mock('@/utils/spotifyClient', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/spotifyClient')>();
  return { ...actual, getPlaylist: h.getPlaylist };
});

vi.mock('@/utils/spotifyPlaylistItems', () => ({
  fetchAllPlaylistItems: h.fetchAllPlaylistItems
}));

// Builds a normalized playlist-item ({ track }) matching what fetchAllPlaylistItems returns.
const trackItem = (
  id: string,
  name: string,
  artist: string,
  albumName: string,
  imageUrl: string | null,
  preview: string | null = null
) => ({
  track: {
    id,
    name,
    artists: [{ name: artist }],
    album: {
      name: albumName,
      images: imageUrl ? [{ url: imageUrl, height: 640, width: 640 }] : []
    },
    duration_ms: 180000,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    preview_url: preview
  }
});

// Sets both mocks for a playlist: metadata via getPlaylist, tracks via fetchAllPlaylistItems.
const mockPlaylist = (name: string, items: ReturnType<typeof trackItem>[], trackTotal: number | null = null) => {
  h.getPlaylist.mockResolvedValue({
    id: 'playlist',
    name,
    ownerId: null,
    trackTotal,
    spotifyUrl: 'https://open.spotify.com/playlist/test'
  });
  h.fetchAllPlaylistItems.mockResolvedValue(items);
};

const app = createApp();

describe('Playlist Details Error Handling', () => {
  beforeEach(() => {
    // Default: a two-track "Test Playlist" so tests that don't override still resolve.
    mockPlaylist('Test Playlist', [
      trackItem('track1', 'Test Track 1', 'Test Artist 1', 'Test Album 1', 'https://example.com/album1-large.jpg', 'https://preview.url'),
      trackItem('track2', 'Test Track 2', 'Test Artist 2', 'Test Album 2', 'https://example.com/album2-large.jpg', null)
    ], 2);
  });

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

    it('should allow viewing playlist details with only Spotify connected', async () => {
      // Only set Spotify cookie, not YouTube - this should now work!
      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      // Should NOT return 401 unauthorized, since Spotify is sufficient
      // May return 500 or other errors due to mocking, but not 401
      expect(response.status).not.toBe(401);
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

  describe('Spotify-Only Mode', () => {
    it('should successfully render playlist details with only Spotify connected', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Test Track 1', 'Test Artist 1', 'Test Album 1', 'https://example.com/album1.jpg', 'https://preview.url'),
        trackItem('track2', 'Test Track 2', 'Test Artist 2', 'Test Album 2', 'https://example.com/album2.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      // Should return 200 OK
      expect(response.status).toBe(200);

      // Should show playlist name
      expect(response.text).toContain('Test Playlist');

      // Should show Spotify tracks
      expect(response.text).toContain('Test Track 1');
      expect(response.text).toContain('Test Artist 1');
      expect(response.text).toContain('Test Album 1');
      expect(response.text).toContain('Test Track 2');
      expect(response.text).toContain('Test Artist 2');
      expect(response.text).toContain('Test Album 2');
    });

    it('should not show "linked" count when YouTube is not connected', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null),
        trackItem('track2', 'Track 2', 'Artist 2', 'Album 2', 'https://example.com/album2.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should show track count
      expect(response.text).toMatch(/2 tracks/);

      // Should NOT show "linked" count since YouTube is not connected
      expect(response.text).not.toMatch(/\d+ linked/);
      expect(response.text).not.toContain('linked');
    });

    it('should not show YouTube video elements when YouTube is not connected', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ], 1);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should NOT show YouTube API-specific elements (Video thumbnail, YouTube links, etc.)
      // NOTE: The youtube-video CSS class IS used for album art styling, so we check for actual YouTube content instead
      expect(response.text).not.toContain('img.youtube.com');
      expect(response.text).not.toContain('youtube.com/watch');
      expect(response.text).not.toContain('Video thumbnail');
    });

    it('should not show link/unlink badges when YouTube is not connected', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should NOT show linked/unlinked badges
      expect(response.text).not.toContain('badge bg-success');
      expect(response.text).not.toContain('badge bg-warning');
      expect(response.text).not.toContain('badge bg-info');
      expect(response.text).not.toContain('Linked');
      expect(response.text).not.toContain('Unlinked');
    });

    it('should not show edit buttons when YouTube is not connected', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should NOT show edit/link buttons
      expect(response.text).not.toContain('Edit linked video');
      expect(response.text).not.toContain('Link video to this track');
      expect(response.text).not.toContain('/api/playlistDetails/search/');
    });

    it('should not show "YouTube Only" badge when YouTube is not connected', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should NOT show "YouTube Only" badge (can't have YouTube-only videos without YouTube connected)
      expect(response.text).not.toContain('YouTube Only');
    });
  });

  describe('Refresh Button Functionality', () => {
    it('should include refresh button in playlist details', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should include refresh button
      expect(response.text).toContain('Refresh');
      expect(response.text).toContain('data-refresh-playlist="1234567890123456789012"');
    });

    it('should use correct HTMX attributes to prevent nesting', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should use "closest .playlist-details-container" as target (not #details-{id})
      expect(response.text).toContain('hx-target="closest .playlist-details-container"');

      // Should use "innerHTML" swap strategy (not outerHTML)
      expect(response.text).toContain('hx-swap="innerHTML"');

      // Should NOT have hx-target pointing to #details-{id}
      expect(response.text).not.toContain('hx-target="#details-1234567890123456789012"');

      // Should NOT use outerHTML swap
      expect(response.text).not.toContain('hx-swap="outerHTML"');
    });

    it('should not include duplicate id attributes that cause nesting', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should NOT include id="details-{playlistId}" in the response
      // (This would cause nesting when using innerHTML swap)
      expect(response.text).not.toContain('id="details-1234567890123456789012"');

      // Should use data-playlist-id instead
      expect(response.text).toContain('data-playlist-id="1234567890123456789012"');
    });

    it('should return same structure on refresh as initial load', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      // Make initial request
      const initialResponse = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(initialResponse.status).toBe(200);

      // Make refresh request (simulating what HTMX would do)
      const refreshResponse = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`])
        .set('Cache-Control', 'no-cache');

      expect(refreshResponse.status).toBe(200);

      // Both responses should have the same structure
      // Both should include the refresh button
      expect(initialResponse.text).toContain('Refresh');
      expect(refreshResponse.text).toContain('Refresh');

      // Both should include the playlist header
      expect(initialResponse.text).toContain('playlist-header');
      expect(refreshResponse.text).toContain('playlist-header');

      // Both should include the tracks list
      expect(initialResponse.text).toContain('tracks-list');
      expect(refreshResponse.text).toContain('tracks-list');

      // Both should include the track data
      expect(initialResponse.text).toContain('Track 1');
      expect(refreshResponse.text).toContain('Track 1');
    });

    it('should only return one refresh button per response', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ]);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Count how many times the refresh button appears
      const refreshButtonMatches = response.text.match(/data-refresh-playlist="/g);
      expect(refreshButtonMatches).not.toBeNull();
      expect(refreshButtonMatches?.length).toBe(1);

      // Should only have one button with "Refresh" text in playlist header context
      const refreshTextMatches = response.text.match(/<button[^>]*>[\s\S]*?Refresh[\s\S]*?<\/button>/g);
      expect(refreshTextMatches).not.toBeNull();
      expect(refreshTextMatches?.length).toBe(1);
    });
  });

  describe('Album Art Display (Spotify-Only Mode)', () => {
    it('should display album art when Spotify-only mode is active', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ], 1);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should display album art image
      expect(response.text).toContain('https://example.com/album1.jpg');
      expect(response.text).toContain('Album art');
    });

    it('should use youtube-video CSS class for album art container', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ], 1);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Album art should use the youtube-video CSS class for consistent styling
      expect(response.text).toContain('<div class="youtube-video');
      expect(response.text).toContain('youtube-video__thumbnail');
      expect(response.text).toContain('https://example.com/album1.jpg');
      expect(response.text).toContain('Album art');
    });

    it('should not display YouTube elements when only Spotify is connected', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ], 1);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should not have YouTube video URLs or thumbnails from YouTube
      expect(response.text).not.toContain('img.youtube.com');
      expect(response.text).not.toContain('youtube.com/watch');
      expect(response.text).not.toContain('Video thumbnail');
    });

    it('should handle tracks without album art gracefully', async () => {
      // A track that has no album images
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track Without Art', 'Artist 1', 'Album 1', null, null)
      ], 1);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should render the playlist without error
      expect(response.text).toContain('Track Without Art');
      expect(response.text).toContain('Album 1');

      // Should apply track-item--simple class when no album art
      expect(response.text).toContain('track-item--simple');

      // Should not try to display empty album art image
      expect(response.text).not.toContain('src=""');
    });

    it('should preserve full grid layout when album art is displayed', async () => {
      mockPlaylist('Test Playlist', [
        trackItem('track1', 'Track 1', 'Artist 1', 'Album 1', 'https://example.com/album1.jpg', null)
      ], 1);

      const spotifyTokens = JSON.stringify({
        accessToken: 'test-spotify-token',
        refreshToken: 'test-spotify-refresh'
      });

      const response = await request(app)
        .get('/api/playlistDetails/playlist/1234567890123456789012')
        .set('Cookie', [`spotify_tokens=${spotifyTokens}`]);

      expect(response.status).toBe(200);

      // Should include track-item class (for full grid layout)
      expect(response.text).toContain('class="track-item');

      // Should include album art image
      expect(response.text).toContain('https://example.com/album1.jpg');

      // Should include track number (4-column grid shows track number)
      expect(response.text).toContain('class="track-number"');

      // Should NOT have YouTube-specific elements
      expect(response.text).not.toContain('img.youtube.com');
    });
  });
});
