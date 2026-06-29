/**
 * Route test for the sync handler's UPDATE path - the one that wiped a playlist.
 *
 * Re-syncing an already-synced, unchanged playlist must reconcile to the SAME
 * order (every existing video present in the desired order), so reconcile plans
 * zero deletes. This pins the desired-order assembly that previously came out
 * empty and deleted everything.
 *
 * reconcilePlaylist is spied (the real planner/safety-rail are tested elsewhere);
 * everything else is mocked so no real API is hit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// --- Spotify: two tracks ---
vi.mock('spotify-web-api-node', () => {
  const SpotifyWebApi = vi.fn();
  SpotifyWebApi.prototype.setAccessToken = vi.fn();
  SpotifyWebApi.prototype.setRefreshToken = vi.fn();
  SpotifyWebApi.prototype.getAccessToken = vi.fn(() => 'spotify-token');
  SpotifyWebApi.prototype.getMe = vi.fn(() => Promise.resolve({ body: { id: 'user' } }));
  SpotifyWebApi.prototype.getPlaylist = vi.fn(() =>
    Promise.resolve({ body: { name: 'My Playlist', tracks: { total: 2 } } })
  );
  return { default: SpotifyWebApi };
});

// --- Spotify /items helper: the two tracks in order ---
vi.mock('@/utils/spotifyPlaylistItems', () => ({
  fetchAllPlaylistItems: vi.fn(() => Promise.resolve([
    { track: { id: 't1', name: 'Song One', type: 'track', artists: [{ name: 'Artist' }] } },
    { track: { id: 't2', name: 'Song Two', type: 'track', artists: [{ name: 'Artist' }] } }
  ]))
}));

// --- Scraper: not needed (nothing unsynced), but mock to be safe ---
vi.mock('@/utils/youtubeScraper', () => ({
  searchMusicVideo: vi.fn(() => Promise.resolve(null))
}));

// --- googleapis: existing playlist already has both videos, titles match tracks ---
vi.mock('googleapis', () => {
  const playlists = {
    list: vi.fn(() => Promise.resolve({ data: { items: [
      { id: 'YT_PL', snippet: { title: 'My Playlist (from Spotify)' } }
    ] } }))
  };
  const playlistItems = {
    list: vi.fn(() => Promise.resolve({ data: { items: [
      { id: 'pi1', snippet: { title: 'Song One', resourceId: { videoId: 'v1' } } },
      { id: 'pi2', snippet: { title: 'Song Two', resourceId: { videoId: 'v2' } } }
    ] } })),
    insert: vi.fn(), update: vi.fn(), delete: vi.fn()
  };
  const channels = { list: vi.fn(() => Promise.resolve({ data: { items: [{ id: 'chan' }] } })) };
  const youtube = vi.fn(() => ({ playlists, playlistItems, channels }));
  const OAuth2 = vi.fn(() => ({ setCredentials: vi.fn(), refreshAccessToken: vi.fn() }));
  return { google: { youtube, auth: { OAuth2 } }, youtube_v3: {} };
});

// --- reconcile: spy the executor, keep the real planner + safety rail ---
vi.mock('@/utils/playlistReconcile', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/playlistReconcile')>();
  return { ...actual, reconcilePlaylist: vi.fn(() => Promise.resolve({ inserted: 0, deleted: 0, moved: 0 })) };
});

import { createApp } from '@/app';
import { reconcilePlaylist } from '@/utils/playlistReconcile';

const app = createApp();
const mockedReconcile = vi.mocked(reconcilePlaylist);

const spotifyCookie = JSON.stringify({ accessToken: 'a', refreshToken: 'b' });
const youtubeCookie = JSON.stringify({
  access_token: 'a', refresh_token: 'b', scope: 's', token_type: 'Bearer', channel_id: 'chan'
});

async function getCsrf() {
  const res = await request(app).get('/health');
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] || []);
  const csrf = setCookie.find(c => c.startsWith('csrf_token='))!;
  const value = csrf.split(';')[0].split('=')[1];
  return { cookie: `csrf_token=${value}`, token: decodeURIComponent(value).split('.')[0] };
}

describe('POST /api/sync/playlist/:id - UPDATE re-sync of an unchanged playlist', () => {
  beforeEach(() => mockedReconcile.mockClear());

  it('reconciles to the same order (all existing videos desired -> zero deletes)', async () => {
    const { cookie, token } = await getCsrf();

    const res = await request(app)
      .post('/api/sync/playlist/1234567890123456789012')
      .set('Cookie', [cookie, `spotify_tokens=${spotifyCookie}`, `youtube_tokens=${youtubeCookie}`])
      .set('X-CSRF-Token', token)
      .send({ batchSize: 'all' });

    expect(res.status).toBe(200);
    expect(mockedReconcile).toHaveBeenCalledTimes(1);

    const [, , desiredVideoIds] = mockedReconcile.mock.calls[0];
    // The fix: desired order contains BOTH existing videos, so reconcile deletes nothing.
    expect(desiredVideoIds).toEqual(['v1', 'v2']);
  });
});
