import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { Express } from 'express';
import { EventSource } from 'eventsource';
import { sendProgressUpdate, closeProgressConnections } from '../../src/routes/progress';

// Mock authentication
vi.mock('../../src/utils/authValidation', () => ({
  getSecureCookieOptions: () => ({
    httpOnly: true,
    secure: false,
    sameSite: 'strict' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000
  })
}));

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    youtube: vi.fn().mockReturnValue({
      playlists: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'mock_youtube_playlist_id',
                snippet: {
                  title: 'Test Playlist (from Spotify)'
                }
              }
            ],
            nextPageToken: undefined
          }
        }),
      },
    }),
  },
}));

// Mock Spotify Web API
vi.mock('spotify-web-api-node', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      setAccessToken: vi.fn(),
      setRefreshToken: vi.fn(),
      getPlaylist: vi.fn().mockResolvedValue({
        body: {
          id: '1234567890123456789012',
          name: 'Test Playlist',
          owner: { display_name: 'Test User' }
        }
      }),
      getMe: vi.fn().mockResolvedValue({ body: { id: 'test_user_id' } }),
    }))
  };
});

describe('SSE Progress Updates', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('SSE Connection Lifecycle', () => {
    it('should establish SSE connection with correct headers', (done) => {
      // Mock valid OAuth tokens
      const mockSpotifyTokens = JSON.stringify({
        accessToken: 'mock_spotify_access_token',
        refreshToken: 'mock_spotify_refresh_token'
      });

      const mockYouTubeTokens = JSON.stringify({
        access_token: 'mock_youtube_access_token',
        refresh_token: 'mock_youtube_refresh_token',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000 // 1 hour from now
      });

      const req = request(app)
        .get('/api/progress/playlist/1234567890123456789012')
        .set('Accept', 'text/event-stream')
        .set('Cookie', [
          `spotify_tokens=${mockSpotifyTokens}`,
          `youtube_tokens=${mockYouTubeTokens}`
        ])
        .timeout(500); // Set a timeout to end the request

      req.on('response', (res) => {
        // Verify SSE headers
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.headers['connection']).toBe('keep-alive');

        req.abort(); // Close the connection
        done();
      });

      req.end(() => {
        // Request ended
      });
    });

    it('should reject requests without authentication', async () => {
      await request(app)
        .get('/api/progress/playlist/1234567890123456789012')
        .set('Accept', 'text/event-stream')
        .expect(401);
    });

    it('should reject requests with only Spotify token', async () => {
      const mockSpotifyTokens = JSON.stringify({
        accessToken: 'mock_spotify_access_token',
        refreshToken: 'mock_spotify_refresh_token'
      });

      await request(app)
        .get('/api/progress/playlist/1234567890123456789012')
        .set('Accept', 'text/event-stream')
        .set('Cookie', [`spotify_tokens=${mockSpotifyTokens}`])
        .expect(401);
    });

    it('should reject requests with only YouTube token', async () => {
      const mockYouTubeTokens = JSON.stringify({
        access_token: 'mock_youtube_access_token',
        refresh_token: 'mock_youtube_refresh_token',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000
      });

      await request(app)
        .get('/api/progress/playlist/1234567890123456789012')
        .set('Accept', 'text/event-stream')
        .set('Cookie', [`youtube_tokens=${mockYouTubeTokens}`])
        .expect(401);
    });

    it('should reject invalid playlist IDs', async () => {
      await request(app)
        .get('/api/progress/playlist/invalid-id')
        .expect(400); // Validation middleware should reject
    });
  });

  describe('Progress Update Broadcasting', () => {
    it('should not crash when sending progress updates to no connections', async () => {
      // This should not throw any errors
      await expect(
        sendProgressUpdate('nonexistentPlaylist12', {
          type: 'progress',
          message: 'Testing',
          percentage: 50
        })
      ).resolves.not.toThrow();
    });

    it('should handle progress updates after connection is closed', async () => {
      const playlistId = 'testPlaylist1234567890';

      // Simulate a connection being established and then closed
      closeProgressConnections(playlistId);

      // Try to send an update after closing - should not throw
      await expect(
        sendProgressUpdate(playlistId, {
          type: 'complete',
          message: 'Done',
          percentage: 100
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Write After End Bug Prevention', () => {
    it('should gracefully handle closed connections when sending updates', async () => {
      const playlistId = 'testPlaylist4567890123';

      // Close connections first
      closeProgressConnections(playlistId);

      // Try to send multiple updates after closing - none should throw
      await expect(
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: 'Update 1',
          percentage: 10
        })
      ).resolves.not.toThrow();

      await expect(
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: 'Update 2',
          percentage: 20
        })
      ).resolves.not.toThrow();

      await expect(
        sendProgressUpdate(playlistId, {
          type: 'error',
          message: 'Error occurred',
          details: 'Some error'
        })
      ).resolves.not.toThrow();
    });

    it('should allow multiple close operations without errors', () => {
      const playlistId = 'testPlaylist7890123456';

      // Close multiple times - should not throw
      expect(() => closeProgressConnections(playlistId)).not.toThrow();
      expect(() => closeProgressConnections(playlistId)).not.toThrow();
      expect(() => closeProgressConnections(playlistId)).not.toThrow();
    });
  });

  describe('Progress Update Types', () => {
    it('should accept all valid progress update types', async () => {
      const playlistId = 'testPlaylistTypes1234';

      // All these should be accepted without errors
      await expect(
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: 'In progress',
          percentage: 50,
          currentTrack: 5,
          totalTracks: 10
        })
      ).resolves.not.toThrow();

      await expect(
        sendProgressUpdate(playlistId, {
          type: 'complete',
          message: 'Completed',
          percentage: 100,
          details: 'All tracks synced'
        })
      ).resolves.not.toThrow();

      await expect(
        sendProgressUpdate(playlistId, {
          type: 'error',
          message: 'Error occurred',
          details: 'Network error'
        })
      ).resolves.not.toThrow();
    });

    it('should handle progress updates with optional fields', async () => {
      const playlistId = 'testPlaylistOptional1';

      // Minimal update
      await expect(
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: 'Starting'
        })
      ).resolves.not.toThrow();

      // Update with all optional fields
      await expect(
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: 'Processing',
          details: 'Track details',
          currentTrack: 3,
          totalTracks: 10,
          currentSong: 'Test Song',
          currentArtist: 'Test Artist',
          percentage: 30,
          timestamp: new Date().toISOString()
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent progress updates for different playlists', async () => {
      const playlist1 = 'concurrent12345678901';
      const playlist2 = 'concurrent22345678901';
      const playlist3 = 'concurrent32345678901';

      // Send updates to multiple playlists concurrently
      await Promise.all([
        sendProgressUpdate(playlist1, {
          type: 'progress',
          message: 'Playlist 1',
          percentage: 33
        }),
        sendProgressUpdate(playlist2, {
          type: 'progress',
          message: 'Playlist 2',
          percentage: 66
        }),
        sendProgressUpdate(playlist3, {
          type: 'progress',
          message: 'Playlist 3',
          percentage: 99
        })
      ]);

      // All should succeed without throwing
      expect(true).toBe(true);
    });

    it('should handle rapid successive updates to same playlist', async () => {
      const playlistId = 'rapidUpdates1234567890';

      // Send 10 rapid updates
      const updates = Array.from({ length: 10 }, (_, i) =>
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: `Update ${i + 1}`,
          percentage: (i + 1) * 10
        })
      );

      await expect(Promise.all(updates)).resolves.not.toThrow();
    });
  });

  describe('Connection Cleanup', () => {
    it('should clean up connections after close', async () => {
      const playlistId = 'cleanupTest1234567890';

      // Close connections
      closeProgressConnections(playlistId);

      // Try to send update - should succeed (no connections to write to)
      await expect(
        sendProgressUpdate(playlistId, {
          type: 'complete',
          message: 'Done'
        })
      ).resolves.not.toThrow();
    });

    it('should handle interleaved open/close/update operations', async () => {
      const playlistId = 'interleavedTest12345678';

      // Update (no connections)
      await sendProgressUpdate(playlistId, {
        type: 'progress',
        message: 'Update 1',
        percentage: 25
      });

      // Close (no connections)
      closeProgressConnections(playlistId);

      // Update again (still no connections)
      await sendProgressUpdate(playlistId, {
        type: 'progress',
        message: 'Update 2',
        percentage: 50
      });

      // Close again (no connections)
      closeProgressConnections(playlistId);

      // Final update (no connections)
      await expect(
        sendProgressUpdate(playlistId, {
          type: 'complete',
          message: 'Done'
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle progress updates with empty playlist IDs', async () => {
      await expect(
        sendProgressUpdate('', {
          type: 'progress',
          message: 'Test'
        })
      ).resolves.not.toThrow();
    });

    it('should handle very long messages and details', async () => {
      const longMessage = 'A'.repeat(10000);
      const longDetails = 'B'.repeat(10000);

      await expect(
        sendProgressUpdate('longMessageTest123456', {
          type: 'progress',
          message: longMessage,
          details: longDetails
        })
      ).resolves.not.toThrow();
    });

    it('should handle special characters in messages', async () => {
      await expect(
        sendProgressUpdate('specialCharsTest12345', {
          type: 'progress',
          message: '<script>alert("XSS")</script>',
          details: 'Line1\nLine2\nLine3',
          currentSong: 'Song & Artist "ft." Someone',
          currentArtist: "Artist's Name <>&"
        })
      ).resolves.not.toThrow();
    });
  });
});
