/**
 * Route tests for the sync handler - the critical path that previously wiped a
 * playlist. These pin the desired order passed to reconcile across the main
 * branches (re-sync unchanged, update with a new track, create, create with no
 * matches) so a future refactor of the handler can't silently regress it.
 *
 * reconcilePlaylist is spied (its planner + safety rail are unit-tested
 * separately); everything else is mocked so no real API is hit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const h = vi.hoisted(() => ({
  getPlaylist: vi.fn(),
  fetchAllPlaylistItems: vi.fn(),
  searchMusicVideo: vi.fn(),
  playlistsList: vi.fn(),
  playlistsInsert: vi.fn(),
  playlistItemsList: vi.fn(),
  reconcilePlaylist: vi.fn(() => Promise.resolve({ inserted: 0, deleted: 0, moved: 0 }))
}));

// The sync route now resolves a valid token via ensureValidSpotifyToken and reads
// playlist metadata via the hand-written spotifyClient's getPlaylist.
vi.mock('@/utils/spotifyAuth', () => ({ ensureValidSpotifyToken: vi.fn(async () => 'test-access-token') }));
vi.mock('@/utils/spotifyClient', () => ({ getPlaylist: h.getPlaylist }));

vi.mock('@/utils/spotifyPlaylistItems', () => ({ fetchAllPlaylistItems: h.fetchAllPlaylistItems }));
vi.mock('@/utils/youtubeScraper', () => ({ searchMusicVideo: h.searchMusicVideo }));

// The sync route resolves a YouTube client via ensureValidYouTubeToken; return a
// fake client wired to the hoisted playlist/playlistItems mocks (writes go through
// the mocked reconcilePlaylist, so insert/update/delete are unused here).
vi.mock('@/utils/youtubeAuth', () => ({
  ensureValidYouTubeToken: vi.fn(async () => ({
    client: {
      playlists: { list: h.playlistsList, insert: h.playlistsInsert },
      playlistItems: { list: h.playlistItemsList, insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
      channels: { list: vi.fn(() => Promise.resolve({ data: { items: [{ id: 'chan' }] } })) }
    },
    accessToken: 'yt-access-token',
    quotaUsed: 1
  }))
}));

vi.mock('@/utils/playlistReconcile', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/playlistReconcile')>();
  return { ...actual, reconcilePlaylist: h.reconcilePlaylist };
});

import { createApp } from '@/app';

const app = createApp();

const spotifyCookie = JSON.stringify({ accessToken: 'a', refreshToken: 'b' });
const youtubeCookie = JSON.stringify({
  access_token: 'a', refresh_token: 'b', scope: 's', token_type: 'Bearer', channel_id: 'chan'
});

const track = (id: string, name: string) => ({ track: { id, name, type: 'track', artists: [{ name: 'Artist' }] } });
const ytItem = (pi: string, videoId: string, title: string) =>
  ({ id: pi, snippet: { title, resourceId: { videoId } } });
const SYNCED_TITLE = 'My Playlist (from Spotify)';

async function getCsrf() {
  const res = await request(app).get('/health');
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] || []);
  const value = setCookie.find(c => c.startsWith('csrf_token='))!.split(';')[0].split('=')[1];
  return { cookie: `csrf_token=${value}`, token: decodeURIComponent(value).split('.')[0] };
}

function post() {
  return getCsrf().then(({ cookie, token }) =>
    request(app)
      .post('/api/sync/playlist/1234567890123456789012')
      .set('Cookie', [cookie, `spotify_tokens=${spotifyCookie}`, `youtube_tokens=${youtubeCookie}`])
      .set('X-CSRF-Token', token)
      .send({ batchSize: 'all' })
  );
}

/** desiredVideoIds passed to the spied reconcile on its most recent call. */
const lastDesired = () => h.reconcilePlaylist.mock.calls.at(-1)?.[2];

describe('POST /api/sync/playlist/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getPlaylist.mockResolvedValue({ id: 'p', name: 'My Playlist', ownerId: 'me', trackTotal: 2, spotifyUrl: 'u' });
    h.reconcilePlaylist.mockResolvedValue({ inserted: 0, deleted: 0, moved: 0 });
    h.searchMusicVideo.mockResolvedValue(null);
  });

  it('re-sync unchanged: reconciles to the existing order, zero deletes', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two')]);
    h.playlistsList.mockResolvedValue({ data: { items: [{ id: 'YT_PL', snippet: { title: SYNCED_TITLE } }] } });
    h.playlistItemsList.mockResolvedValue({ data: { items: [ytItem('pi1', 'v1', 'Song One'), ytItem('pi2', 'v2', 'Song Two')] } });

    const res = await post();

    expect(res.status).toBe(200);
    expect(h.reconcilePlaylist).toHaveBeenCalledTimes(1);
    expect(lastDesired()).toEqual(['v1', 'v2']); // both existing videos present -> no orphan deletes
  });

  it('update with a new track: desired order keeps existing and appends the new video', async () => {
    h.getPlaylist.mockResolvedValue({ id: 'p', name: 'My Playlist', ownerId: 'me', trackTotal: 3, spotifyUrl: 'u' });
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two'), track('t3', 'Song Three')]);
    h.playlistsList.mockResolvedValue({ data: { items: [{ id: 'YT_PL', snippet: { title: SYNCED_TITLE } }] } });
    h.playlistItemsList.mockResolvedValue({ data: { items: [ytItem('pi1', 'v1', 'Song One'), ytItem('pi2', 'v2', 'Song Two')] } });
    h.searchMusicVideo.mockImplementation((_artist: string, song: string) => Promise.resolve(song === 'Song Three' ? 'v3' : null));

    const res = await post();

    expect(res.status).toBe(200);
    expect(lastDesired()).toEqual(['v1', 'v2', 'v3']);
  });

  it('create: no existing playlist, builds desired order from found videos', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two')]);
    h.playlistsList.mockResolvedValue({ data: { items: [] } }); // none synced yet
    h.playlistsInsert.mockResolvedValue({ data: { id: 'NEW_PL', snippet: { title: SYNCED_TITLE } } });
    h.playlistItemsList.mockResolvedValue({ data: { items: [] } });
    h.searchMusicVideo.mockImplementation((_artist: string, song: string) =>
      Promise.resolve(song === 'Song One' ? 'v1' : song === 'Song Two' ? 'v2' : null));

    const res = await post();

    expect(res.status).toBe(200);
    expect(h.reconcilePlaylist).toHaveBeenCalledTimes(1);
    expect(lastDesired()).toEqual(['v1', 'v2']);
  });

  it('create with no matches: errors and never reconciles (no destructive writes)', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two')]);
    h.playlistsList.mockResolvedValue({ data: { items: [] } });
    h.searchMusicVideo.mockResolvedValue(null); // nothing found for any track

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.text).toContain('No videos found');
    expect(h.reconcilePlaylist).not.toHaveBeenCalled();
    expect(h.playlistsInsert).not.toHaveBeenCalled();
  });
});
