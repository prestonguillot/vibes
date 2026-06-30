/**
 * Route tests for the sync handler - the critical path that previously wiped a
 * playlist. These pin the desired order passed to reconcile across the main
 * branches (re-sync unchanged, update with a new track, create, create with no
 * matches) so a future refactor of the handler can't silently regress it.
 *
 * The sync now runs inside the SSE stream route (GET /playlist/:id/stream), which
 * streams progress + the final result as `event: message` frames; supertest reads
 * the whole streamed body. reconcilePlaylist is spied (its planner + safety rail
 * are unit-tested separately); everything else is mocked so no real API is hit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { youtubeCircuitBreaker } from '@/lib/circuitBreaker';

const h = vi.hoisted(() => ({
  getPlaylist: vi.fn(),
  fetchAllPlaylistItems: vi.fn(),
  searchMusicVideo: vi.fn(),
  playlistsList: vi.fn(),
  playlistsInsert: vi.fn(),
  playlistItemsList: vi.fn(),
  reconcilePlaylist: vi.fn(() => Promise.resolve({ inserted: 0, deleted: 0, moved: 0 })),
}));

vi.mock('@/spotify/auth', () => ({
  ensureValidSpotifyToken: vi.fn(async () => 'test-access-token'),
}));
vi.mock('@/spotify/client', () => ({ getPlaylist: h.getPlaylist }));
vi.mock('@/spotify/playlistItems', () => ({ fetchAllPlaylistItems: h.fetchAllPlaylistItems }));
vi.mock('@/youtube/scraper', () => ({ searchMusicVideo: h.searchMusicVideo }));

vi.mock('@/youtube/auth', () => ({
  ensureValidYouTubeToken: vi.fn(async () => ({
    client: {
      playlists: { list: h.playlistsList, insert: h.playlistsInsert },
      playlistItems: {
        list: h.playlistItemsList,
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      channels: { list: vi.fn(() => Promise.resolve({ data: { items: [{ id: 'chan' }] } })) },
    },
    accessToken: 'yt-access-token',
    quotaUsed: 1,
  })),
}));

vi.mock('@/sync/playlistReconcile', async (importActual) => {
  const actual = await importActual<typeof import('@/sync/playlistReconcile')>();
  return { ...actual, reconcilePlaylist: h.reconcilePlaylist };
});

import { createApp } from '@/app';

const app = createApp();

const spotifyCookie = JSON.stringify({ accessToken: 'a', refreshToken: 'b' });
const youtubeCookie = JSON.stringify({
  access_token: 'a',
  refresh_token: 'b',
  scope: 's',
  token_type: 'Bearer',
  channel_id: 'chan',
});

const track = (id: string, name: string) => ({
  track: { id, name, type: 'track', artists: [{ name: 'Artist' }] },
});
const ytItem = (pi: string, videoId: string, title: string) => ({
  id: pi,
  snippet: { title, resourceId: { videoId } },
});
const SYNCED_TITLE = 'My Playlist (from Spotify)';

// Drive the SSE stream route (GET, no CSRF - SameSite=strict cookies protect it).
// supertest buffers the whole event-stream body once the handler ends it.
function stream(batchSize = 'all') {
  return request(app)
    .get(`/api/sync/playlist/1234567890123456789012/stream?batchSize=${batchSize}`)
    .set('Cookie', [`spotify_tokens=${spotifyCookie}`, `youtube_tokens=${youtubeCookie}`]);
}

/** desiredVideoIds passed to the spied reconcile on its most recent call. */
const lastDesired = () => h.reconcilePlaylist.mock.calls.at(-1)?.[2];

describe('GET /api/sync/playlist/:id/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    youtubeCircuitBreaker.close(); // isolate the quota test, which opens the breaker
    h.getPlaylist.mockResolvedValue({
      id: 'p',
      name: 'My Playlist',
      ownerId: 'me',
      trackTotal: 2,
      spotifyUrl: 'u',
    });
    h.reconcilePlaylist.mockResolvedValue({ inserted: 0, deleted: 0, moved: 0 });
    h.searchMusicVideo.mockResolvedValue(null);
  });

  it('re-sync unchanged: reconciles to the existing order, zero deletes', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two')]);
    h.playlistsList.mockResolvedValue({
      data: { items: [{ id: 'YT_PL', snippet: { title: SYNCED_TITLE } }] },
    });
    h.playlistItemsList.mockResolvedValue({
      data: { items: [ytItem('pi1', 'v1', 'Song One'), ytItem('pi2', 'v2', 'Song Two')] },
    });

    const res = await stream();

    expect(res.status).toBe(200);
    expect(h.reconcilePlaylist).toHaveBeenCalledTimes(1);
    expect(lastDesired()).toEqual(['v1', 'v2']); // both existing videos present -> no orphan deletes
  });

  it('update with a new track: desired order keeps existing and appends the new video', async () => {
    h.getPlaylist.mockResolvedValue({
      id: 'p',
      name: 'My Playlist',
      ownerId: 'me',
      trackTotal: 3,
      spotifyUrl: 'u',
    });
    h.fetchAllPlaylistItems.mockResolvedValue([
      track('t1', 'Song One'),
      track('t2', 'Song Two'),
      track('t3', 'Song Three'),
    ]);
    h.playlistsList.mockResolvedValue({
      data: { items: [{ id: 'YT_PL', snippet: { title: SYNCED_TITLE } }] },
    });
    h.playlistItemsList.mockResolvedValue({
      data: { items: [ytItem('pi1', 'v1', 'Song One'), ytItem('pi2', 'v2', 'Song Two')] },
    });
    h.searchMusicVideo.mockImplementation((_artist: string, song: string) =>
      Promise.resolve(song === 'Song Three' ? 'v3' : null),
    );

    const res = await stream();

    expect(res.status).toBe(200);
    expect(lastDesired()).toEqual(['v1', 'v2', 'v3']);
  });

  it('create: no existing playlist, builds desired order from found videos', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two')]);
    h.playlistsList.mockResolvedValue({ data: { items: [] } }); // none synced yet
    h.playlistsInsert.mockResolvedValue({
      data: { id: 'NEW_PL', snippet: { title: SYNCED_TITLE } },
    });
    h.playlistItemsList.mockResolvedValue({ data: { items: [] } });
    h.searchMusicVideo.mockImplementation((_artist: string, song: string) =>
      Promise.resolve(song === 'Song One' ? 'v1' : song === 'Song Two' ? 'v2' : null),
    );

    const res = await stream();

    expect(res.status).toBe(200);
    expect(h.reconcilePlaylist).toHaveBeenCalledTimes(1);
    expect(lastDesired()).toEqual(['v1', 'v2']);
  });

  it('create with no matches: streams an error and never reconciles (no destructive writes)', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two')]);
    h.playlistsList.mockResolvedValue({ data: { items: [] } });
    h.searchMusicVideo.mockResolvedValue(null); // nothing found for any track

    const res = await stream();

    expect(res.status).toBe(200);
    expect(res.text).toContain('No videos found');
    expect(h.reconcilePlaylist).not.toHaveBeenCalled();
    expect(h.playlistsInsert).not.toHaveBeenCalled();
  });

  it('quota exceeded on a write: streams the quota partial, not the generic error', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One')]);
    h.playlistsList.mockResolvedValue({ data: { items: [] } }); // create mode
    h.searchMusicVideo.mockResolvedValue('v1');
    // A real 403 from the write -> youtubeWrite converts it to YoutubeQuotaError.
    h.playlistsInsert.mockRejectedValue(
      Object.assign(new Error('403'), { code: 403, errors: [{ reason: 'quotaExceeded' }] }),
    );

    const res = await stream();

    expect(res.status).toBe(200);
    expect(res.text).toContain('YouTube Quota Exceeded');
  });

  it('missing auth: 401 before the stream opens', async () => {
    const res = await request(app).get(
      '/api/sync/playlist/1234567890123456789012/stream?batchSize=all',
    );
    expect(res.status).toBe(401);
  });
});
