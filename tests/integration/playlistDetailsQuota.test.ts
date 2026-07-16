/**
 * YouTube quota-error handling for the playlist-details route.
 *
 * The route must turn YouTube quota exhaustion into a friendly "YouTube Quota
 * Exceeded" partial (HTTP 403) rather than a raw 500. Quota surfaces two ways:
 * writes throw YoutubeQuotaError, reads throw a 403 YoutubeApiError with
 * reason quotaExceeded/rateLimitExceeded. A non-quota 403 must NOT be mistaken
 * for quota (it falls through to the generic error).
 *
 * fetchPlaylistDetails is mocked to throw, and the X-YT-Playlist-Id header is
 * set so the route skips playlist resolution and goes straight to that fetch.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';
import { spotifyTokenCookie, youtubeTokenCookie } from '@tests/helpers/tokenCookies';
import { testServer } from '@tests/helpers/testServer';
import { YoutubeApiError } from '@/youtube/client';
import { YoutubeQuotaError } from '@/youtube/writes';

const h = vi.hoisted(() => ({ fetchPlaylistDetails: vi.fn() }));

vi.mock('@/sync/playlistDetailsService', async (importActual) => {
  const actual = await importActual<typeof import('@/sync/playlistDetailsService')>();
  return { ...actual, fetchPlaylistDetails: h.fetchPlaylistDetails };
});

const app = testServer(createApp());

const spotifyCookie = spotifyTokenCookie('sp-token', 'sp-refresh');
const youtubeCookie = youtubeTokenCookie({ access_token: 'yt-token' });
const playlistId = '1234567890123456789012';

// Both cookies + a cached playlist id so the route reaches fetchPlaylistDetails directly.
function getDetails() {
  return request(app)
    .get(`/api/playlistDetails/playlist/${playlistId}`)
    .set('Cookie', [spotifyCookie, youtubeCookie])
    .set('X-YT-Playlist-Id', 'cached-yt-playlist-id');
}

describe('Playlist Details - YouTube quota handling', () => {
  // Each test fully (re)sets the implementation below, so no reset hook is needed -
  // and a mockReset() here trips vitest's error tracker on the rejecting mock.

  it('returns the 403 quota partial on a read 403 quotaExceeded YoutubeApiError', async () => {
    h.fetchPlaylistDetails.mockImplementation(() =>
      Promise.reject(new YoutubeApiError('quota', 403, 'quotaExceeded')),
    );
    const res = await getDetails();
    expect(res.status).toBe(403);
    expect(res.text).toContain('YouTube Quota Exceeded');
  });

  it('returns the 403 quota partial on a rateLimitExceeded YoutubeApiError', async () => {
    h.fetchPlaylistDetails.mockImplementation(() =>
      Promise.reject(new YoutubeApiError('rate', 403, 'rateLimitExceeded')),
    );
    const res = await getDetails();
    expect(res.status).toBe(403);
    expect(res.text).toContain('YouTube Quota Exceeded');
  });

  it('returns the 403 quota partial when a write surfaces a YoutubeQuotaError', async () => {
    h.fetchPlaylistDetails.mockImplementation(() =>
      Promise.reject(new YoutubeQuotaError('quota exceeded')),
    );
    const res = await getDetails();
    expect(res.status).toBe(403);
    expect(res.text).toContain('YouTube Quota Exceeded');
  });

  it('treats a non-quota 403 as the generic error, not the quota message', async () => {
    h.fetchPlaylistDetails.mockImplementation(() =>
      Promise.reject(new YoutubeApiError('forbidden', 403, 'forbidden')),
    );
    const res = await getDetails();
    expect(res.status).toBe(500);
    expect(res.text).toContain('Error loading playlist details');
    expect(res.text).not.toContain('YouTube Quota Exceeded');
  });
});
