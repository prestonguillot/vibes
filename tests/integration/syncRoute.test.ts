/**
 * Route tests for the sync handler - the path that rewrites a whole playlist, where a wrong
 * desired order costs the user their playlist. These pin the order passed to reconcile across the
 * main branches (re-sync unchanged, update with a new track, create, create with no matches).
 *
 * The sync runs inside the SSE stream route (GET /playlist/:id/stream), which
 * streams progress + the final result as `event: message` frames; supertest reads
 * the whole streamed body. reconcilePlaylist is spied (its planner + safety rail
 * are unit-tested separately); everything else is mocked so no real API is hit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { youtubeCircuitBreaker } from '@/lib/circuitBreaker';
import { YoutubeApiError } from '@/youtube/client';
import { findSetCookie } from '@tests/helpers/httpCookies';

const h = vi.hoisted(() => ({
  sleep: vi.fn(() => Promise.resolve()),
  getPlaylist: vi.fn(),
  fetchAllPlaylistItems: vi.fn(),
  searchMusicVideo: vi.fn(),
  playlistsList: vi.fn(),
  playlistsInsert: vi.fn(),
  playlistItemsList: vi.fn(),
  reconcilePlaylist: vi.fn<typeof import('@/sync/playlistReconcile').reconcilePlaylist>(() =>
    Promise.resolve({ inserted: 0, deleted: 0, moved: 0 }),
  ),
}));

vi.mock('@/lib/delay', () => ({ sleep: h.sleep }));
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

  // YouTube rejects writes to a playlist it has only just created, and reconcile is what writes.
  it('create: waits after creating the playlist, before writing to it', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One')]);
    h.playlistsList.mockResolvedValue({ data: { items: [] } });
    h.playlistsInsert.mockResolvedValue({
      data: { id: 'NEW_PL', snippet: { title: SYNCED_TITLE } },
    });
    h.playlistItemsList.mockResolvedValue({ data: { items: [] } });
    h.searchMusicVideo.mockResolvedValue('v1');

    await stream();

    expect(h.sleep).toHaveBeenCalledWith(2000);
    expect(h.playlistsInsert.mock.invocationCallOrder[0]!).toBeLessThan(
      h.sleep.mock.invocationCallOrder[0]!,
    );
    expect(h.sleep.mock.invocationCallOrder[0]!).toBeLessThan(
      h.reconcilePlaylist.mock.invocationCallOrder[0]!,
    );
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
    // Exactly what the client throws for a 403 quota response; youtubeWrite turns it into a
    // YoutubeQuotaError.
    h.playlistsInsert.mockRejectedValue(
      new YoutubeApiError('YouTube API error (403): quota', 403, 'quotaExceeded'),
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

/**
 * The subscriber endpoint. The POST does not sync - it renders the SSE subscriber, and htmx's sse
 * extension then opens the stream above. Splitting it that way is what lets the sync survive the
 * POST response ending.
 */
describe('POST /api/sync/playlist/:id', () => {
  const csrf = async () => {
    const page = await request(app).get('/');
    const cookie = findSetCookie(page, 'csrf_token')!.split(';')[0]!;
    return { cookie, token: cookie.split('=')[1]!.split('.')[0]! };
  };

  const subscribe = async (
    body: Record<string, string> = {},
    opts: { withCsrf?: boolean } = {},
  ) => {
    const { cookie, token } = await csrf();
    const req = request(app)
      .post('/api/sync/playlist/1234567890123456789012')
      .set('Cookie', [
        `spotify_tokens=${spotifyCookie}`,
        `youtube_tokens=${youtubeCookie}`,
        cookie,
      ]);
    if (opts.withCsrf !== false) req.set('x-csrf-token', token);
    return req.send(body);
  };

  beforeEach(() => vi.clearAllMocks());

  it('renders a subscriber pointed at the stream for this playlist', async () => {
    const response = await subscribe({ batchSize: '5' });

    expect(response.status).toBe(200);
    expect(response.text).toContain('1234567890123456789012');
  });

  it('passes the batch size through to the stream URL', async () => {
    const response = await subscribe({ batchSize: '5' });

    expect(response.text).toContain('batchSize=5');
  });

  it('defaults the batch size to 1', async () => {
    const response = await subscribe({});

    expect(response.text).toContain('batchSize=1');
  });

  // A POST that writes to a playlist has to be CSRF-protected, even though it only renders here -
  // it is what starts the sync.
  it('rejects a request with no CSRF token', async () => {
    const response = await subscribe({ batchSize: '1' }, { withCsrf: false });

    expect(response.status).toBe(403);
  });

  it('rejects an unusable batch size', async () => {
    const response = await subscribe({ batchSize: 'not-a-number' });

    expect(response.status).toBe(400);
  });

  it('rejects a malformed playlist id', async () => {
    const { cookie, token } = await csrf();

    const response = await request(app)
      .post('/api/sync/playlist/nope')
      .set('Cookie', [`spotify_tokens=${spotifyCookie}`, cookie])
      .set('x-csrf-token', token)
      .send({});

    expect(response.status).toBe(400);
  });

  // The subscriber renders without touching Spotify or YouTube; the stream does the work.
  it('does not start syncing', async () => {
    await subscribe({ batchSize: '1' });

    expect(h.getPlaylist).not.toHaveBeenCalled();
    expect(h.fetchAllPlaylistItems).not.toHaveBeenCalled();
  });
});

describe('GET stream: batch size and empty playlists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    youtubeCircuitBreaker.close();
    h.getPlaylist.mockResolvedValue({
      id: 'p',
      name: 'My Playlist',
      ownerId: 'me',
      trackTotal: 2,
      spotifyUrl: 'u',
    });
    h.reconcilePlaylist.mockResolvedValue({ inserted: 0, deleted: 0, moved: 0 });
    h.searchMusicVideo.mockResolvedValue('v1');
    h.playlistsList.mockResolvedValue({ data: { items: [] } });
    h.playlistsInsert.mockResolvedValue({ data: { id: 'NEW_PL' } });
    h.playlistItemsList.mockResolvedValue({ data: { items: [] } });
  });

  it('searches only the first track when the batch size is 1', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two')]);

    await stream('1');

    expect(h.searchMusicVideo).toHaveBeenCalledTimes(1);
  });

  it('searches every track when the batch size is all', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One'), track('t2', 'Song Two')]);

    await stream('all');

    expect(h.searchMusicVideo).toHaveBeenCalledTimes(2);
  });

  it('stops at the batch size when it is smaller than the playlist', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      track('t1', 'One'),
      track('t2', 'Two'),
      track('t3', 'Three'),
    ]);

    await stream('2');

    expect(h.searchMusicVideo).toHaveBeenCalledTimes(2);
  });

  it('reports an empty playlist instead of creating an empty YouTube one', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([]);

    const response = await stream('all');

    expect(response.text).toContain('No Tracks Found');
    expect(h.playlistsInsert).not.toHaveBeenCalled();
  });

  // Local files and podcast episodes come back in the items list but cannot be searched for.
  it('reports a playlist of nothing but unplayable items as empty', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      { track: { id: 'e1', name: 'An Episode', type: 'episode', artists: [] } },
    ]);

    const response = await stream('all');

    expect(response.text).toContain('No Tracks Found');
    expect(h.searchMusicVideo).not.toHaveBeenCalled();
  });

  it('streams progress before the result', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One')]);

    const response = await stream('all');

    expect(response.text).toContain('Starting sync');
    expect(response.text).toContain('Finding music videos');
  });

  it('ends the stream with a close frame', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([track('t1', 'Song One')]);

    const response = await stream('all');

    expect(response.text).toContain('event: close');
  });
});
