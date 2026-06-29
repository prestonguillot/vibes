/**
 * Regression tests for resilience against malformed Spotify API responses.
 *
 * Spotify's playlist endpoints can return objects with missing fields (e.g. a
 * playlist with no `tracks` paging object). Previously this crashed
 * fetchPlaylistDetails with "Cannot read properties of undefined (reading 'total')".
 * These tests pin the defensive behavior. Track fetching itself goes through the
 * /items helper (mocked here); see spotifyPlaylistItems.test.ts for that path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import SpotifyWebApi from 'spotify-web-api-node';
import { fetchPlaylistDetails } from '../../src/services/playlistDetailsService';
import { fetchAllPlaylistItems } from '../../src/utils/spotifyPlaylistItems';

vi.mock('../../src/utils/spotifyPlaylistItems', () => ({
  fetchAllPlaylistItems: vi.fn()
}));

const mockedFetchAllPlaylistItems = vi.mocked(fetchAllPlaylistItems);

function makeSpotifyApiMock(playlistBody: any): SpotifyWebApi {
  return {
    getAccessToken: vi.fn(() => 'test-access-token'),
    getPlaylist: vi.fn(() => Promise.resolve({ body: playlistBody }))
  } as unknown as SpotifyWebApi;
}

const makeItem = (id: string, name: string) => ({
  track: {
    id,
    name,
    type: 'track',
    artists: [{ name: 'Some Artist' }],
    album: { name: 'Some Album', images: [{ url: 'http://img/x.jpg' }] },
    duration_ms: 200000,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    preview_url: null
  }
});

describe('fetchPlaylistDetails resilience', () => {
  beforeEach(() => {
    mockedFetchAllPlaylistItems.mockReset();
  });

  it('does not crash when the playlist body has no tracks field', async () => {
    // No `tracks` property at all - this is what used to crash.
    const spotifyApi = makeSpotifyApiMock({ name: 'Malformed Playlist' });
    mockedFetchAllPlaylistItems.mockResolvedValue([makeItem('t1', 'Song One'), makeItem('t2', 'Song Two')]);

    const result = await fetchPlaylistDetails(spotifyApi, null, 'playlist-123');

    expect(result.playlistName).toBe('Malformed Playlist');
    // Total falls back to the number of tracks actually fetched.
    expect(result.totalTracks).toBe(2);
    expect(result.tracks).toHaveLength(2);
    expect(result.hasYoutubePlaylist).toBe(false);
  });

  it('drops items whose track is null or undefined without crashing', async () => {
    const spotifyApi = makeSpotifyApiMock({ name: 'Mixed Playlist', tracks: { total: 4 } });
    mockedFetchAllPlaylistItems.mockResolvedValue([
      makeItem('t1', 'Good One'),
      { track: null },
      { track: undefined } as any,
      makeItem('t2', 'Good Two')
    ]);

    const result = await fetchPlaylistDetails(spotifyApi, null, 'playlist-456');

    expect(result.tracks).toHaveLength(2);
    expect(result.tracks.map(t => t.spotify?.id)).toEqual(['t1', 't2']);
  });

  it('handles an empty playlist without crashing', async () => {
    const spotifyApi = makeSpotifyApiMock({ name: 'Empty Playlist', tracks: { total: 0 } });
    mockedFetchAllPlaylistItems.mockResolvedValue([]);

    const result = await fetchPlaylistDetails(spotifyApi, null, 'playlist-789');

    expect(result.totalTracks).toBe(0);
    expect(result.tracks).toHaveLength(0);
  });
});
