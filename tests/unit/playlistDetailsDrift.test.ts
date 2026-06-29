/**
 * Tests for the needsResync (drift) flag computed by fetchPlaylistDetails: true
 * when a sync would change the YouTube playlist (order drift, orphan videos, or
 * unsynced tracks), false when the two playlists already agree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getPlaylist: vi.fn(), fetchAllPlaylistItems: vi.fn() }));
vi.mock('../../src/utils/spotifyClient', async (importActual) => ({
  ...(await importActual<typeof import('../../src/utils/spotifyClient')>()),
  getPlaylist: h.getPlaylist
}));
vi.mock('../../src/utils/spotifyPlaylistItems', () => ({ fetchAllPlaylistItems: h.fetchAllPlaylistItems }));

import { fetchPlaylistDetails } from '../../src/services/playlistDetailsService';

const sTrack = (id: string, name: string) =>
  ({ track: { id, name, type: 'track', artists: [{ name: 'Artist' }], album: { name: 'Album', images: [] } } });

// Minimal youtube stub: one page of playlist items in the given video/title order.
const youtubeStub = (videos: Array<[string, string]>) => ({
  playlistItems: {
    list: vi.fn(async () => ({
      data: { items: videos.map(([videoId, title], i) => ({ id: `pi${i}`, snippet: { title, resourceId: { videoId } } })) }
    }))
  }
}) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.getPlaylist.mockResolvedValue({ id: 'p', name: 'P', ownerId: 'me', trackTotal: null, spotifyUrl: 'u' });
});

describe('fetchPlaylistDetails needsResync', () => {
  it('is false when YouTube videos match Spotify tracks in the same order', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A'), sTrack('t2', 'Song B')]);
    const details = await fetchPlaylistDetails('tok', youtubeStub([['v1', 'Song A'], ['v2', 'Song B']]), 'p', 'YT');
    expect(details.needsResync).toBe(false);
  });

  it('is true when the YouTube order differs from Spotify order', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A'), sTrack('t2', 'Song B')]);
    const details = await fetchPlaylistDetails('tok', youtubeStub([['v2', 'Song B'], ['v1', 'Song A']]), 'p', 'YT');
    expect(details.needsResync).toBe(true);
  });

  it('is true when a Spotify track has no matching video (unsynced track)', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A'), sTrack('t2', 'Song B')]);
    const details = await fetchPlaylistDetails('tok', youtubeStub([['v1', 'Song A']]), 'p', 'YT');
    expect(details.needsResync).toBe(true);
  });

  it('is true when there is an orphan YouTube video', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A')]);
    const details = await fetchPlaylistDetails('tok', youtubeStub([['v1', 'Song A'], ['vX', 'Unrelated Clip']]), 'p', 'YT');
    expect(details.needsResync).toBe(true);
  });

  it('is false when there is no YouTube playlist', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A')]);
    const details = await fetchPlaylistDetails('tok', null, 'p');
    expect(details.hasYoutubePlaylist).toBe(false);
    expect(details.needsResync).toBe(false);
  });
});
