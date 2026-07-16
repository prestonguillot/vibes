/**
 * Tests for the needsResync (drift) flag computed by fetchPlaylistDetails: true
 * when a sync would change the YouTube playlist (order drift, orphan videos, or
 * unsynced tracks), false when the two playlists already agree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getPlaylist: vi.fn(), fetchAllPlaylistItems: vi.fn() }));
vi.mock('../../src/spotify/client', async (importActual) => ({
  ...(await importActual<typeof import('../../src/spotify/client')>()),
  getPlaylist: h.getPlaylist,
}));
vi.mock('../../src/spotify/playlistItems', () => ({
  fetchAllPlaylistItems: h.fetchAllPlaylistItems,
}));

import { fetchPlaylistDetails } from '../../src/sync/playlistDetailsService';

const sTrack = (id: string, name: string) => ({
  track: {
    id,
    name,
    type: 'track',
    artists: [{ name: 'Artist' }],
    album: { name: 'Album', images: [] },
  },
});

// Minimal youtube stub: one page of playlist items in the given video/title order.
const youtubeStub = (videos: Array<[string, string]>) =>
  ({
    playlistItems: {
      list: vi.fn(async () => ({
        data: {
          items: videos.map(([videoId, title], i) => ({
            id: `pi${i}`,
            snippet: { title, resourceId: { videoId } },
          })),
        },
      })),
    },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.getPlaylist.mockResolvedValue({
    id: 'p',
    name: 'P',
    ownerId: 'me',
    trackTotal: null,
    spotifyUrl: 'u',
  });
});

describe('fetchPlaylistDetails needsResync', () => {
  it('is false when YouTube videos match Spotify tracks in the same order', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A'), sTrack('t2', 'Song B')]);
    const details = await fetchPlaylistDetails(
      'tok',
      youtubeStub([
        ['v1', 'Song A'],
        ['v2', 'Song B'],
      ]),
      'p',
      'YT',
    );
    expect(details.needsResync).toBe(false);
  });

  it('is true when the YouTube order differs from Spotify order', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A'), sTrack('t2', 'Song B')]);
    const details = await fetchPlaylistDetails(
      'tok',
      youtubeStub([
        ['v2', 'Song B'],
        ['v1', 'Song A'],
      ]),
      'p',
      'YT',
    );
    expect(details.needsResync).toBe(true);
  });

  it('is true when a Spotify track has no matching video (unsynced track)', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A'), sTrack('t2', 'Song B')]);
    const details = await fetchPlaylistDetails('tok', youtubeStub([['v1', 'Song A']]), 'p', 'YT');
    expect(details.needsResync).toBe(true);
  });

  it('is true when there is an orphan YouTube video', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A')]);
    const details = await fetchPlaylistDetails(
      'tok',
      youtubeStub([
        ['v1', 'Song A'],
        ['vX', 'Unrelated Clip'],
      ]),
      'p',
      'YT',
    );
    expect(details.needsResync).toBe(true);
  });

  it('is false when there is no YouTube playlist', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A')]);
    const details = await fetchPlaylistDetails('tok', null, 'p');
    expect(details.hasYoutubePlaylist).toBe(false);
    expect(details.needsResync).toBe(false);
  });

  /**
   * The ordinary state of every playlist that has never been synced: YouTube IS connected, and
   * there is simply no playlist to compare against. Both halves are needed - a client with no id
   * has nothing to fetch, and an id with no client has nothing to fetch it with. Either one alone
   * asking YouTube for items would be a call for a playlist that does not exist.
   */
  it('is false when YouTube is connected but the playlist has never been synced', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A')]);
    const youtube = youtubeStub([]);

    const details = await fetchPlaylistDetails('tok', youtube, 'p', undefined);

    expect(details.hasYoutubePlaylist).toBe(false);
    expect(details.needsResync).toBe(false);
    // Nothing to ask about, so nothing was asked.
    expect(
      (youtube as unknown as { playlistItems: { list: ReturnType<typeof vi.fn> } }).playlistItems
        .list,
    ).not.toHaveBeenCalled();
  });

  it('is false when an id is known but YouTube is not connected', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A')]);

    const details = await fetchPlaylistDetails('tok', null, 'p', 'PL-known');

    expect(details.hasYoutubePlaylist).toBe(false);
    expect(details.needsResync).toBe(false);
  });

  /**
   * The scar the code comments describe: a contested track's song is already in the playlist under
   * another track's slot, so a search finds that same video and sync drops it as a duplicate.
   * Counting it as drift kept the dot on permanently and invited a re-sync that reconciles to 0
   * ops - the flag telling the user to spend quota achieving nothing.
   */
  it('is false when the only unlinked track is one whose song is already in the playlist', async () => {
    // Two Spotify tracks with the same song name: only one can own the single video.
    h.fetchAllPlaylistItems.mockResolvedValue([sTrack('t1', 'Song A'), sTrack('t2', 'Song A')]);

    const details = await fetchPlaylistDetails('tok', youtubeStub([['v1', 'Song A']]), 'p', 'PL');

    expect(details.linkedCount).toBe(1);
    expect(details.needsResync).toBe(false);
  });
});
