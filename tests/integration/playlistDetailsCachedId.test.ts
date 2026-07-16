/**
 * The YouTube playlist id the client caches, and what the route does with it.
 *
 * Resolving the id from scratch means listing every playlist the user has and looking the Spotify
 * name up to match against - so the client caches the id the route reports and sends it back as
 * X-YT-Playlist-Id, and the route trusts it. The saving is the point of the header.
 *
 * A trusted id can be wrong: the playlist may have been deleted or recreated since. That is what
 * the retry is for, and none of it was tested - the client half is (youtubeCache.test.ts), the
 * server half was not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const h = vi.hoisted(() => ({
  getPlaylist: vi.fn(),
  fetchPlaylistDetails: vi.fn(),
  findSyncedYoutubePlaylist: vi.fn(),
  ensureValidYouTubeToken: vi.fn(),
}));

vi.mock('@/youtube/auth', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/auth')>()),
  ensureValidYouTubeToken: h.ensureValidYouTubeToken,
}));

vi.mock('@/spotify/client', async (importActual) => ({
  ...(await importActual<typeof import('@/spotify/client')>()),
  getPlaylist: h.getPlaylist,
}));
vi.mock('@/sync/playlistDetailsService', () => ({ fetchPlaylistDetails: h.fetchPlaylistDetails }));
vi.mock('@/youtube/playlist', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/playlist')>()),
  findSyncedYoutubePlaylist: h.findSyncedYoutubePlaylist,
}));
vi.mock('@/youtube/client', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/client')>()),
  createYoutubeClient: () => ({ playlists: { list: vi.fn() } }),
}));

import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';
import { spotifyTokenCookie, youtubeTokenCookie } from '@tests/helpers/tokenCookies';

const app = testServer(createApp());

const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';
const SPOTIFY_COOKIE = spotifyTokenCookie();
const YOUTUBE_COOKIE = youtubeTokenCookie();

const details = (hasYoutubePlaylist = true) => ({
  playlistId: PLAYLIST_ID,
  playlistName: 'My Playlist',
  tracks: [],
  linkedCount: 0,
  totalTracks: 0,
  hasYoutubePlaylist,
  needsResync: false,
});

/** GET the details, optionally presenting a cached id the way the client does. */
const get = (cachedId?: string, cookies = [SPOTIFY_COOKIE, YOUTUBE_COOKIE]) => {
  const req = request(app)
    .get(`/api/playlistDetails/playlist/${PLAYLIST_ID}`)
    .set('Cookie', cookies);
  if (cachedId !== undefined) req.set('X-YT-Playlist-Id', cachedId);
  return req;
};

/** The id fetchPlaylistDetails was asked for on its most recent call. */
const askedFor = () => h.fetchPlaylistDetails.mock.calls.at(-1)?.[3];

const notFound = () => Object.assign(new Error('playlist is gone'), { code: 404 });

beforeEach(() => {
  vi.clearAllMocks();
  h.getPlaylist.mockResolvedValue({
    id: PLAYLIST_ID,
    name: 'My Playlist',
    ownerId: 'me',
    trackTotal: 0,
    spotifyUrl: 'u',
  });
  h.findSyncedYoutubePlaylist.mockResolvedValue({ id: 'RESOLVED_PL' });
  h.fetchPlaylistDetails.mockResolvedValue(details());
  h.ensureValidYouTubeToken.mockResolvedValue({
    client: { playlists: { list: vi.fn() } },
    accessToken: 'yt',
    quotaUsed: 0,
  });
});

describe('the cached YouTube playlist id', () => {
  it('is trusted, and skips resolving one', async () => {
    await get('CACHED_PL');

    expect(askedFor()).toBe('CACHED_PL');
    // The whole point: no playlist listing, no Spotify name lookup.
    expect(h.findSyncedYoutubePlaylist).not.toHaveBeenCalled();
    expect(h.getPlaylist).not.toHaveBeenCalled();
  });

  it('is resolved by name when the client has none', async () => {
    await get();

    expect(h.findSyncedYoutubePlaylist).toHaveBeenCalled();
    expect(askedFor()).toBe('RESOLVED_PL');
  });

  it.each([[''], ['   ']])('is resolved by name when the header is %o', async (header) => {
    await get(header);

    expect(h.findSyncedYoutubePlaylist).toHaveBeenCalled();
    expect(askedFor()).toBe('RESOLVED_PL');
  });

  it('is reported back, so the client can cache it', async () => {
    const response = await get();

    expect(response.headers['x-yt-playlist-id']).toBe('RESOLVED_PL');
  });

  // An empty header is how a client is told to drop what it has.
  it('is reported as empty when the user has no synced playlist', async () => {
    h.findSyncedYoutubePlaylist.mockResolvedValue(null);

    const response = await get();

    expect(response.headers['x-yt-playlist-id']).toBe('');
  });

  it('is not reported at all when YouTube is not connected', async () => {
    const response = await get(undefined, [SPOTIFY_COOKIE]);

    expect(response.status).toBe(200);
    expect(response.headers['x-yt-playlist-id']).toBeUndefined();
  });
});

/**
 * A YouTube connection that cannot be refreshed is over. The panel used to answer that with
 * "Unable to fetch playlist information. Please try again" - advice that cannot work, in place of
 * the reconnect that would.
 */
describe('when the YouTube connection has run out', () => {
  it('offers a reconnect rather than telling the user to try again', async () => {
    h.ensureValidYouTubeToken.mockRejectedValue(new Error('YOUTUBE_AUTH_REQUIRED'));

    const response = await get('CACHED_PL');

    expect(response.status).toBe(401);
    expect(response.text).toContain('Reconnect to YouTube');
    expect(response.text).toContain('/auth/youtube/login');
    expect(response.text).not.toContain('Please try again');
  });
});

/**
 * A cached id is a guess about the past: the playlist may have been deleted or recreated since. A
 * 404 on a trusted id is not an error to report, it is a cache to correct.
 */
describe('when the cached id has gone stale', () => {
  it('resolves a fresh one and tries again', async () => {
    h.fetchPlaylistDetails.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(details());

    const response = await get('STALE_PL');

    expect(response.status).toBe(200);
    expect(h.fetchPlaylistDetails).toHaveBeenCalledTimes(2);
    expect(h.fetchPlaylistDetails.mock.calls[0]![3]).toBe('STALE_PL');
    expect(h.fetchPlaylistDetails.mock.calls[1]![3]).toBe('RESOLVED_PL');
  });

  it('reports the fresh id, so the client stops sending the dead one', async () => {
    h.fetchPlaylistDetails.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(details());

    const response = await get('STALE_PL');

    expect(response.headers['x-yt-playlist-id']).toBe('RESOLVED_PL');
  });

  it('clears the client cache when there is no playlist to find any more', async () => {
    h.fetchPlaylistDetails.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(details(false));
    h.findSyncedYoutubePlaylist.mockResolvedValue(null);

    const response = await get('STALE_PL');

    expect(response.status).toBe(200);
    expect(response.headers['x-yt-playlist-id']).toBe('');
  });

  // Only a 404 says "wrong id". Retrying a quota refusal spends more quota to be refused again.
  it.each([[403], [500], [undefined]])('does not retry a %s', async (code) => {
    h.fetchPlaylistDetails.mockRejectedValue(Object.assign(new Error('nope'), { code }));

    const response = await get('CACHED_PL');

    expect(response.status).toBe(500);
    expect(h.fetchPlaylistDetails).toHaveBeenCalledTimes(1);
  });

  // Nothing was trusted, so a 404 here is the truth rather than a stale guess.
  it('does not retry when there was no cached id to be wrong about', async () => {
    h.fetchPlaylistDetails.mockRejectedValue(notFound());

    const response = await get();

    expect(response.status).toBe(500);
    expect(h.fetchPlaylistDetails).toHaveBeenCalledTimes(1);
  });
});
