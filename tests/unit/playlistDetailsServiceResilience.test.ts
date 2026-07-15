/**
 * Resilience against malformed Spotify API responses.
 *
 * Spotify's playlist endpoints can return objects with missing fields (e.g. a playlist with no
 * track-count), and fetchPlaylistDetails must survive them rather than crash on
 * "Cannot read properties of undefined (reading 'total')". Track fetching itself goes through the
 * /items helper (mocked here); see spotifyPlaylistItems.test.ts for that path.
 *
 * spotifyClient maps a missing track-count to `trackTotal: null`, so a playlist with no
 * `tracks.total` resolves with `trackTotal: null`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPlaylistDetails } from '../../src/sync/playlistDetailsService';
import { fetchAllPlaylistItems } from '../../src/spotify/playlistItems';
import { getPlaylist } from '../../src/spotify/client';

vi.mock('../../src/spotify/playlistItems', () => ({
  fetchAllPlaylistItems: vi.fn(),
}));

vi.mock('../../src/spotify/client', async (importActual) => {
  const actual = await importActual<typeof import('../../src/spotify/client')>();
  return { ...actual, getPlaylist: vi.fn() };
});

const mockedFetchAllPlaylistItems = vi.mocked(fetchAllPlaylistItems);
const mockedGetPlaylist = vi.mocked(getPlaylist);

const makePlaylist = (name: string, trackTotal: number | null) => ({
  id: 'playlist',
  name,
  ownerId: null,
  trackTotal,
  spotifyUrl: 'https://open.spotify.com/playlist/playlist',
});

const makeItem = (id: string, name: string) => ({
  track: {
    id,
    name,
    type: 'track',
    artists: [{ name: 'Some Artist' }],
    album: { name: 'Some Album', images: [{ url: 'http://img/x.jpg' }] },
    duration_ms: 200000,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    preview_url: null,
  },
});

describe('fetchPlaylistDetails resilience', () => {
  beforeEach(() => {
    mockedFetchAllPlaylistItems.mockReset();
    mockedGetPlaylist.mockReset();
  });

  it('does not crash when the playlist has no track count', async () => {
    // No track count at all, which spotifyClient maps to trackTotal: null.
    mockedGetPlaylist.mockResolvedValue(makePlaylist('Malformed Playlist', null));
    mockedFetchAllPlaylistItems.mockResolvedValue([
      makeItem('t1', 'Song One'),
      makeItem('t2', 'Song Two'),
    ]);

    const result = await fetchPlaylistDetails('test-access-token', null, 'playlist-123');

    expect(result.playlistName).toBe('Malformed Playlist');
    // Total falls back to the number of tracks actually fetched.
    expect(result.totalTracks).toBe(2);
    expect(result.tracks).toHaveLength(2);
    expect(result.hasYoutubePlaylist).toBe(false);
  });

  it('drops items whose track is null or undefined without crashing', async () => {
    mockedGetPlaylist.mockResolvedValue(makePlaylist('Mixed Playlist', 4));
    mockedFetchAllPlaylistItems.mockResolvedValue([
      makeItem('t1', 'Good One'),
      { track: null },
      { track: undefined } as any,
      makeItem('t2', 'Good Two'),
    ]);

    const result = await fetchPlaylistDetails('test-access-token', null, 'playlist-456');

    expect(result.tracks).toHaveLength(2);
    expect(result.tracks.map((t) => t.spotify?.id)).toEqual(['t1', 't2']);
  });

  it('handles an empty playlist without crashing', async () => {
    mockedGetPlaylist.mockResolvedValue(makePlaylist('Empty Playlist', 0));
    mockedFetchAllPlaylistItems.mockResolvedValue([]);

    const result = await fetchPlaylistDetails('test-access-token', null, 'playlist-789');

    expect(result.totalTracks).toBe(0);
    expect(result.tracks).toHaveLength(0);
  });
});
