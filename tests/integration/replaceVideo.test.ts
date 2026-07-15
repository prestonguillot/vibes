/**
 * Tests for POST /api/playlistDetails/replace/:trackId - the manual "use this video instead" write.
 *
 * This is the only place the app writes to a YouTube playlist outside a sync.
 *
 * The handler sleeps 1s (replace) / 3s (add) waiting for YouTube to propagate before reordering,
 * so these run in real time rather than fighting supertest with fake timers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const h = vi.hoisted(() => ({
  getPlaylist: vi.fn(),
  fetchAllPlaylistItems: vi.fn(),
  reconcilePlaylist: vi.fn(),
  playlistsList: vi.fn(),
  playlistItemsList: vi.fn(),
  playlistItemsInsert: vi.fn(),
  playlistItemsDelete: vi.fn(),
}));

vi.mock('@/spotify/client', async (importActual) => ({
  ...(await importActual<typeof import('@/spotify/client')>()),
  getPlaylist: h.getPlaylist,
}));
vi.mock('@/spotify/playlistItems', () => ({ fetchAllPlaylistItems: h.fetchAllPlaylistItems }));
vi.mock('@/sync/playlistReconcile', async (importActual) => ({
  ...(await importActual<typeof import('@/sync/playlistReconcile')>()),
  reconcilePlaylist: h.reconcilePlaylist,
}));
vi.mock('@/youtube/client', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/client')>()),
  createYoutubeClient: () => ({
    playlists: { list: h.playlistsList },
    playlistItems: {
      list: h.playlistItemsList,
      insert: h.playlistItemsInsert,
      delete: h.playlistItemsDelete,
    },
  }),
}));

import { createApp } from '@/app';
import { findSetCookie } from '@tests/helpers/httpCookies';

const app = createApp();

const SPOTIFY_COOKIE = 'spotify_tokens={"accessToken":"sp-token","refreshToken":"sp-refresh"}';
const YOUTUBE_COOKIE =
  'youtube_tokens={"access_token":"yt-token","refresh_token":"yt-refresh","scope":"s","token_type":"Bearer"}';

const TRACK_ID = '4iV5W9uYEdYUVa79Axb7Rh';
const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';
const NEW_VIDEO = 'dQw4w9WgXcQ';
const OLD_VIDEO = 'oldVideo123';

/** A real CSRF token pair, minted by the app's own cookie middleware. */
async function csrf() {
  const page = await request(app).get('/');
  const cookie = findSetCookie(page, 'csrf_token')!.split(';')[0]!;
  const token = cookie.split('=')[1]!.split('.')[0]!;
  return { cookie, token };
}

async function replace(
  body: Record<string, string>,
  opts: { cookies?: string[]; withCsrf?: boolean } = {},
) {
  const { cookie, token } = await csrf();
  const cookies = opts.cookies ?? [SPOTIFY_COOKIE, YOUTUBE_COOKIE];
  const req = request(app)
    .post(`/api/playlistDetails/replace/${TRACK_ID}`)
    .set('Cookie', [...cookies, cookie]);
  if (opts.withCsrf !== false) req.set('x-csrf-token', token);
  return req.send(body);
}

const syncedPlaylist = { id: 'PL-yt', snippet: { title: 'My Playlist (from Spotify)' } };

beforeEach(() => {
  vi.clearAllMocks();
  h.getPlaylist.mockResolvedValue({
    id: PLAYLIST_ID,
    name: 'My Playlist',
    ownerId: 'me',
    trackTotal: 1,
    spotifyUrl: 'https://open.spotify.com/playlist/x',
  });
  h.playlistsList.mockResolvedValue({ data: { items: [syncedPlaylist] } });
  h.playlistItemsList.mockResolvedValue({
    data: {
      items: [{ id: 'item-old', snippet: { position: 3, resourceId: { videoId: OLD_VIDEO } } }],
    },
  });
  h.playlistItemsInsert.mockResolvedValue({ data: {} });
  h.playlistItemsDelete.mockResolvedValue({ data: undefined });
  h.fetchAllPlaylistItems.mockResolvedValue([]);
  h.reconcilePlaylist.mockResolvedValue({ inserted: 0, deleted: 0, moved: 0 });
});

describe('POST /replace: refusing the request', () => {
  it('rejects a request with no CSRF token', async () => {
    const response = await replace(
      { newVideoId: NEW_VIDEO, currentVideoId: OLD_VIDEO, playlistId: PLAYLIST_ID },
      { withCsrf: false },
    );

    expect(response.status).toBe(403);
    // It must refuse BEFORE writing anything to YouTube.
    expect(h.playlistItemsInsert).not.toHaveBeenCalled();
  });

  it('requires YouTube to be connected', async () => {
    const response = await replace(
      { newVideoId: NEW_VIDEO, currentVideoId: OLD_VIDEO, playlistId: PLAYLIST_ID },
      { cookies: [SPOTIFY_COOKIE] },
    );

    expect(response.status).toBe(401);
    expect(response.text).toContain('YouTube Authentication Required');
  });

  it('requires Spotify to be connected', async () => {
    const response = await replace(
      { newVideoId: NEW_VIDEO, currentVideoId: OLD_VIDEO, playlistId: PLAYLIST_ID },
      { cookies: [YOUTUBE_COOKIE] },
    );

    expect(response.status).toBe(401);
    expect(response.text).toContain('Spotify Authentication Required');
  });

  it.each([
    ['a missing newVideoId', { currentVideoId: OLD_VIDEO, playlistId: PLAYLIST_ID }],
    ['a malformed newVideoId', { newVideoId: 'not a video id!', playlistId: PLAYLIST_ID }],
    ['a missing playlistId', { newVideoId: NEW_VIDEO }],
  ])('rejects %s', async (_label, body) => {
    expect((await replace(body as Record<string, string>)).status).toBe(400);
  });

  it('reports when the synced YouTube playlist does not exist', async () => {
    h.playlistsList.mockResolvedValue({ data: { items: [] } });

    const response = await replace({
      newVideoId: NEW_VIDEO,
      currentVideoId: OLD_VIDEO,
      playlistId: PLAYLIST_ID,
    });

    expect(response.status).toBe(404);
    expect(response.text).toContain('Playlist not found');
    expect(h.playlistItemsInsert).not.toHaveBeenCalled();
  });

  it('reports when the video being replaced is not in the playlist', async () => {
    h.playlistItemsList.mockResolvedValue({ data: { items: [] } });

    const response = await replace({
      newVideoId: NEW_VIDEO,
      currentVideoId: OLD_VIDEO,
      playlistId: PLAYLIST_ID,
    });

    expect(response.status).toBe(404);
    expect(response.text).toContain('Video not found');
    // Nothing was written - it did not add the new video and leave the old one behind.
    expect(h.playlistItemsInsert).not.toHaveBeenCalled();
    expect(h.playlistItemsDelete).not.toHaveBeenCalled();
  });
});

describe('POST /replace: replacing an existing video', () => {
  it('inserts the new video at the old one position, then deletes the old', async () => {
    const response = await replace({
      newVideoId: NEW_VIDEO,
      currentVideoId: OLD_VIDEO,
      playlistId: PLAYLIST_ID,
    });

    expect(response.status).toBe(200);
    // Position is the point: the replacement must land where the old video sat, not at the end.
    expect(h.playlistItemsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          snippet: expect.objectContaining({
            playlistId: 'PL-yt',
            position: 3,
            resourceId: { kind: 'youtube#video', videoId: NEW_VIDEO },
          }),
        }),
      }),
    );
    expect(h.playlistItemsDelete).toHaveBeenCalledWith({ id: 'item-old' });
  });

  it('inserts before deleting, so the slot is never empty', async () => {
    await replace({ newVideoId: NEW_VIDEO, currentVideoId: OLD_VIDEO, playlistId: PLAYLIST_ID });

    expect(h.playlistItemsInsert.mock.invocationCallOrder[0]).toBeLessThan(
      h.playlistItemsDelete.mock.invocationCallOrder[0]!,
    );
  });

  it('tells the user it worked', async () => {
    const response = await replace({
      newVideoId: NEW_VIDEO,
      currentVideoId: OLD_VIDEO,
      playlistId: PLAYLIST_ID,
    });

    expect(response.text).toContain('Video replaced successfully');
  });
});

describe('POST /replace: adding a video to an unlinked track', () => {
  it('appends the video when there is no current video', async () => {
    const response = await replace({ newVideoId: NEW_VIDEO, playlistId: PLAYLIST_ID });

    expect(response.status).toBe(200);
    expect(response.text).toContain('Video linked successfully');
    expect(h.playlistItemsInsert).toHaveBeenCalled();
    // Add mode must not delete anything - there is nothing to replace.
    expect(h.playlistItemsDelete).not.toHaveBeenCalled();
  });

  it('treats an empty currentVideoId as adding, not replacing', async () => {
    const response = await replace({
      newVideoId: NEW_VIDEO,
      currentVideoId: '',
      playlistId: PLAYLIST_ID,
    });

    expect(response.status).toBe(200);
    expect(h.playlistItemsDelete).not.toHaveBeenCalled();
  });
});

describe('POST /replace: the reorder afterwards', () => {
  it('reconciles the playlist back into Spotify order', async () => {
    await replace({ newVideoId: NEW_VIDEO, currentVideoId: OLD_VIDEO, playlistId: PLAYLIST_ID });

    expect(h.reconcilePlaylist).toHaveBeenCalled();
  });

  // The write already succeeded by this point. A reorder failure must not tell the user their
  // change was lost - it wasn't.
  it('still reports success when the reorder fails', async () => {
    h.reconcilePlaylist.mockRejectedValue(new Error('quota exceeded'));

    const response = await replace({
      newVideoId: NEW_VIDEO,
      currentVideoId: OLD_VIDEO,
      playlistId: PLAYLIST_ID,
    });

    expect(response.status).toBe(200);
    expect(response.text).toContain('Video replaced successfully');
  });

  it('honours the manual pick over what matching would choose', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      { track: { id: TRACK_ID, name: 'Creep', type: 'track', artists: [{ name: 'Radiohead' }] } },
    ]);
    h.playlistItemsList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'item-old',
            snippet: {
              position: 0,
              resourceId: { videoId: OLD_VIDEO },
              title: 'Radiohead - Creep',
            },
          },
        ],
      },
    });

    await replace({ newVideoId: NEW_VIDEO, currentVideoId: OLD_VIDEO, playlistId: PLAYLIST_ID });

    // The desired order must contain the user's choice, not the video the matcher liked.
    const desiredVideoIds = h.reconcilePlaylist.mock.calls[0]![2] as string[];
    expect(desiredVideoIds).toContain(NEW_VIDEO);
    expect(desiredVideoIds).not.toContain(OLD_VIDEO);
  });
});

describe('POST /replace: failures', () => {
  it('reports a 500 when the write itself fails', async () => {
    h.playlistItemsInsert.mockRejectedValue(new Error('youtube exploded'));

    const response = await replace({
      newVideoId: NEW_VIDEO,
      currentVideoId: OLD_VIDEO,
      playlistId: PLAYLIST_ID,
    });

    expect(response.status).toBe(500);
    expect(response.text).toContain('Video replacement failed');
  });

  it('reports a 500 when Spotify cannot be reached', async () => {
    h.getPlaylist.mockRejectedValue(new Error('spotify down'));

    const response = await replace({
      newVideoId: NEW_VIDEO,
      currentVideoId: OLD_VIDEO,
      playlistId: PLAYLIST_ID,
    });

    expect(response.status).toBe(500);
  });
});
