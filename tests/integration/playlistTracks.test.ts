/**
 * Tests for GET /api/playlistTracks - the endpoint client-side playlist search reads.
 *
 * 0 of its 10 functions had ever been executed by a test: playlistSearch.test.ts mocks this
 * endpoint on the CLIENT side and never touches the server module, so nothing here ran at all.
 *
 * The behaviour worth pinning most is the resilience: one unreadable playlist must not fail the
 * whole request, because search covers every playlist at once.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const h = vi.hoisted(() => ({ ensureValidSpotifyToken: vi.fn(), fetchAllPlaylistItems: vi.fn() }));
vi.mock('@/spotify/auth', () => ({ ensureValidSpotifyToken: h.ensureValidSpotifyToken }));
vi.mock('@/spotify/playlistItems', () => ({ fetchAllPlaylistItems: h.fetchAllPlaylistItems }));

import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';

const app = testServer(createApp());

const item = (name: string, artist = 'Radiohead') => ({
  track: { id: `t-${name}`, name, type: 'track', artists: [{ name: artist }] },
});

const get = (query: string) => request(app).get(`/api/playlistTracks?${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  h.ensureValidSpotifyToken.mockResolvedValue('token');
  h.fetchAllPlaylistItems.mockResolvedValue([item('Creep')]);
});

describe('GET /api/playlistTracks: validation', () => {
  it('returns the tracks keyed by playlist id', async () => {
    const response = await get('playlistIds=pl1');

    expect(response.status).toBe(200);
    expect(response.body.tracks).toEqual({ pl1: ['Radiohead • Creep'] });
  });

  it('rejects a request with no playlistIds', async () => {
    expect((await get('')).status).toBe(400);
  });

  it('rejects an empty playlistIds', async () => {
    expect((await get('playlistIds=')).status).toBe(400);
  });

  it('rejects more than 100 playlists', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `pl${i}`).join(',');

    expect((await get(`playlistIds=${ids}`)).status).toBe(400);
  });

  it('accepts exactly 100 playlists', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `pl${i}`).join(',');

    expect((await get(`playlistIds=${ids}`)).status).toBe(200);
  });

  // "a,,b" is two ids, not three - the blank is filtered before the length check.
  it('filters blank ids out of the list', async () => {
    const response = await get('playlistIds=pl1,,pl2');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.tracks)).toEqual(['pl1', 'pl2']);
    expect(h.fetchAllPlaylistItems).toHaveBeenCalledTimes(2);
  });

  it('rejects a list of nothing but blanks', async () => {
    expect((await get('playlistIds=,,')).status).toBe(400);
  });
});

describe('GET /api/playlistTracks: auth', () => {
  it('returns 401 when there is no valid Spotify token', async () => {
    h.ensureValidSpotifyToken.mockRejectedValue(new Error('SPOTIFY_AUTH_REQUIRED'));

    const response = await get('playlistIds=pl1');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Spotify authentication required' });
  });

  it('does not fetch anything when auth fails', async () => {
    h.ensureValidSpotifyToken.mockRejectedValue(new Error('SPOTIFY_AUTH_REQUIRED'));

    await get('playlistIds=pl1');

    expect(h.fetchAllPlaylistItems).not.toHaveBeenCalled();
  });
});

/**
 * This is the index the song search runs on. A playlist that could not be read is not a playlist
 * with no songs - but it used to be reported as one, so a search for a song sitting in it matched
 * nothing and read as "you do not have that". Saying which ones failed is what lets the page say
 * the search is incomplete instead of quietly being wrong.
 */
describe('GET /api/playlistTracks: resilience', () => {
  // Search asks for every playlist at once, so one bad playlist must not blank the whole feature.
  it('keeps the others when one playlist fails', async () => {
    h.fetchAllPlaylistItems.mockImplementation(async (_token: string, playlistId: string) => {
      if (playlistId === 'bad') throw new Error('404 playlist gone');
      return [item('Creep')];
    });

    const response = await get('playlistIds=good,bad');

    expect(response.status).toBe(200);
    expect(response.body.tracks).toEqual({ good: ['Radiohead • Creep'] });
  });

  it('names the playlist that failed rather than calling it empty', async () => {
    h.fetchAllPlaylistItems.mockImplementation(async (_token: string, playlistId: string) => {
      if (playlistId === 'bad') throw new Error('404 playlist gone');
      return [item('Creep')];
    });

    const response = await get('playlistIds=good,bad');

    expect(response.body.failed).toEqual(['bad']);
    // The distinction that matters: absent, not present-and-empty.
    expect(response.body.tracks).not.toHaveProperty('bad');
  });

  // A playlist that really has no songs is an answer, and must not read as a failure.
  it('reports a genuinely empty playlist as empty, not failed', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([]);

    const response = await get('playlistIds=pl1');

    expect(response.body.tracks).toEqual({ pl1: [] });
    expect(response.body.failed).toEqual([]);
  });

  it('still answers 200 when every playlist fails, and says so', async () => {
    h.fetchAllPlaylistItems.mockRejectedValue(new Error('spotify is down'));

    const response = await get('playlistIds=pl1,pl2');

    expect(response.status).toBe(200);
    expect(response.body.tracks).toEqual({});
    expect(response.body.failed).toEqual(['pl1', 'pl2']);
  });

  /**
   * Each playlist is a paginated fetch. Sixty of them at once is a few hundred requests in a burst,
   * which Spotify answers with 429 - so asking for the search index is what made the search index
   * wrong. The work is bounded instead.
   */
  it('does not ask Spotify for everything at once', async () => {
    let inFlight = 0;
    let peak = 0;
    h.fetchAllPlaylistItems.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return [item('Creep')];
    });

    const ids = Array.from({ length: 40 }, (_, i) => `pl${i}`).join(',');
    await get(`playlistIds=${ids}`);

    expect(peak).toBeLessThanOrEqual(5);
    expect(h.fetchAllPlaylistItems).toHaveBeenCalledTimes(40);
  });
});

describe('GET /api/playlistTracks: track mapping', () => {
  it('formats a track as "Artist • Name"', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([item('Karma Police', 'Radiohead')]);

    expect((await get('playlistIds=pl1')).body.tracks.pl1).toEqual(['Radiohead • Karma Police']);
  });

  it('falls back to Unknown Artist when a track has no artists', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      { track: { id: 't1', name: 'Creep', type: 'track', artists: [] } },
    ]);

    expect((await get('playlistIds=pl1')).body.tracks.pl1).toEqual(['Unknown Artist • Creep']);
  });

  it.each([
    ['a null track', { track: null }],
    ['a track with no name', { track: { id: 't1', artists: [{ name: 'X' }] } }],
  ])('drops %s', async (_label, badItem) => {
    h.fetchAllPlaylistItems.mockResolvedValue([badItem, item('Creep')]);

    expect((await get('playlistIds=pl1')).body.tracks.pl1).toEqual(['Radiohead • Creep']);
  });

  it('fetches every requested playlist', async () => {
    await get('playlistIds=pl1,pl2,pl3');

    expect(h.fetchAllPlaylistItems).toHaveBeenCalledTimes(3);
  });
});
