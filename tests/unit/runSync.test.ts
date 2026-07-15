/**
 * The sync engine itself (src/sync/runSync.ts).
 *
 * This was 440 lines inside routes/sync.ts, unexported, reachable only by opening an SSE stream -
 * so 229 mutants lived here that no route test could kill. It decides what gets written to the
 * user's YouTube playlist, and it is the one place in the app that can destroy something they care
 * about. Now that it takes its callbacks as arguments, it can be run without a stream to attach to.
 *
 * The YouTube/Spotify boundaries are faked; classifyTracksForSync, buildSyncDesiredVideoIds and the
 * EJS partials are real, so a template that a change breaks fails here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getPlaylist: vi.fn(),
  fetchAllPlaylistItems: vi.fn(),
  findSyncedYoutubePlaylist: vi.fn(),
  fetchAllYoutubePlaylistItems: vi.fn(),
  searchTracksForVideos: vi.fn(),
  reconcilePlaylist: vi.fn(),
  fetchPlaylistDetails: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('@/spotify/client', async (importActual) => ({
  ...(await importActual<typeof import('@/spotify/client')>()),
  getPlaylist: h.getPlaylist,
}));
vi.mock('@/spotify/playlistItems', () => ({ fetchAllPlaylistItems: h.fetchAllPlaylistItems }));
vi.mock('@/youtube/playlist', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/playlist')>()),
  findSyncedYoutubePlaylist: h.findSyncedYoutubePlaylist,
  fetchAllYoutubePlaylistItems: h.fetchAllYoutubePlaylistItems,
}));
vi.mock('@/sync/videoSearch', () => ({ searchTracksForVideos: h.searchTracksForVideos }));
vi.mock('@/sync/playlistReconcile', async (importActual) => ({
  ...(await importActual<typeof import('@/sync/playlistReconcile')>()),
  reconcilePlaylist: h.reconcilePlaylist,
}));
vi.mock('@/sync/playlistDetailsService', () => ({ fetchPlaylistDetails: h.fetchPlaylistDetails }));
// The real one waits two seconds for a new playlist to become writable.
vi.mock('@/lib/delay', () => ({ sleep: h.sleep }));

import { runSync, SyncDeps } from '@/sync/runSync';
import type { TrackSearchResult } from '@/sync/videoSearch';
import type { ProgressUpdate } from '@/types/progress';

const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';

const spotifyTrack = (id: string, name: string) => ({
  track: { id, name, type: 'track', artists: [{ name: 'An Artist' }], duration_ms: 1000 },
});

/** A YouTube playlist item as the API returns it. */
const ytItem = (videoId: string, title: string) => ({
  id: `item-${videoId}`,
  snippet: { title, resourceId: { videoId }, videoOwnerChannelTitle: 'An Artist - Topic' },
});

/**
 * What videoSearch reports per track. spotifyTrackId is what buildSyncDesiredVideoIds keys the
 * order off - a result without it is dropped from the playlist silently.
 */
const searchResult = (
  spotifyTrackId: string,
  track: string,
  found: boolean,
  videoId?: string,
): TrackSearchResult => ({
  track,
  artist: 'An Artist',
  found,
  spotifyTrackId,
  spotifyPosition: Number(spotifyTrackId.replace('t', '')) - 1,
  ...(videoId ? { videoId } : {}),
});

let emitted: string[];
let progress: ProgressUpdate[];
let youtube: { playlists: { insert: ReturnType<typeof vi.fn> } };

const run = (overrides: Partial<SyncDeps> = {}) =>
  runSync({
    playlistId: PLAYLIST_ID,
    batchSizeRaw: undefined,
    spotifyAccessToken: 'sp-token',
    youtube: youtube as unknown as SyncDeps['youtube'],
    initialQuotaUsed: 0,
    emit: (html) => emitted.push(html),
    emitProgress: async (update) => {
      progress.push(update);
    },
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  emitted = [];
  progress = [];
  youtube = { playlists: { insert: vi.fn().mockResolvedValue({ data: { id: 'NEW_PL' } }) } };

  h.getPlaylist.mockResolvedValue({
    id: PLAYLIST_ID,
    name: 'My Playlist',
    ownerId: 'me',
    trackTotal: 2,
    spotifyUrl: 'https://open.spotify.com/playlist/x',
  });
  h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack('t1', 'One'), spotifyTrack('t2', 'Two')]);
  h.findSyncedYoutubePlaylist.mockResolvedValue(null);
  h.fetchAllYoutubePlaylistItems.mockResolvedValue([]);
  h.searchTracksForVideos.mockResolvedValue({
    videoIds: ['v1', 'v2'],
    searchResults: [searchResult('t1', 'One', true, 'v1'), searchResult('t2', 'Two', true, 'v2')],
  });
  h.reconcilePlaylist.mockResolvedValue({ inserted: 2, moved: 0, deleted: 0 });
  h.fetchPlaylistDetails.mockResolvedValue({
    playlistId: PLAYLIST_ID,
    playlistName: 'My Playlist',
    tracks: [],
    linkedCount: 2,
    totalTracks: 2,
    hasYoutubePlaylist: true,
    needsResync: false,
  });
  h.sleep.mockResolvedValue(undefined);
});

describe('creating a playlist that does not exist yet', () => {
  it('creates it private, titled from the Spotify playlist', async () => {
    await run();

    expect(youtube.playlists.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          status: { privacyStatus: 'private' },
          snippet: expect.objectContaining({
            description: 'Synced from Spotify playlist: My Playlist',
          }),
        }),
      }),
    );
  });

  // A brand-new playlist is not immediately writable; inserting straight away fails.
  it('waits before the first insert', async () => {
    await run();

    expect(h.sleep).toHaveBeenCalledWith(2000);
    expect(h.sleep.mock.invocationCallOrder[0]!).toBeLessThan(
      h.reconcilePlaylist.mock.invocationCallOrder[0]!,
    );
  });

  it('reconciles into the new playlist against nothing', async () => {
    await run();

    const [, playlistId, desired, current] = h.reconcilePlaylist.mock.calls[0]!;
    expect(playlistId).toBe('NEW_PL');
    expect(desired).toEqual(['v1', 'v2']);
    expect(current).toEqual([]);
  });

  it('reports the finished playlist', async () => {
    await run();

    expect(progress.at(-1)).toMatchObject({ type: 'complete', percentage: 100 });
    expect(emitted.at(-1)).toContain('https://www.youtube.com/playlist?list=NEW_PL');
  });
});

describe('updating a playlist that already exists', () => {
  beforeEach(() => {
    h.findSyncedYoutubePlaylist.mockResolvedValue({ id: 'EXISTING_PL' });
    h.fetchAllYoutubePlaylistItems.mockResolvedValue([ytItem('v1', 'One')]);
  });

  it('does not create a second playlist', async () => {
    await run();

    expect(youtube.playlists.insert).not.toHaveBeenCalled();
  });

  it('reconciles against what the playlist already holds', async () => {
    h.searchTracksForVideos.mockResolvedValue({
      videoIds: ['v2'],
      searchResults: [searchResult('t2', 'Two', true, 'v2')],
    });

    await run();

    const [, playlistId, , current] = h.reconcilePlaylist.mock.calls[0]!;
    expect(playlistId).toBe('EXISTING_PL');
    expect(current).toEqual([{ videoId: 'v1', playlistItemId: 'item-v1' }]);
  });

  /**
   * An item missing either id cannot be moved: reconcile needs the playlistItemId to address it.
   * Passing it through would have reconcile try to move something it cannot name.
   */
  it('ignores an existing item with no video id', async () => {
    h.fetchAllYoutubePlaylistItems.mockResolvedValue([
      ytItem('v1', 'One'),
      { id: 'item-broken', snippet: { title: 'no resourceId' } },
    ]);

    await run();

    const [, , , current] = h.reconcilePlaylist.mock.calls[0]!;
    expect(current).toEqual([{ videoId: 'v1', playlistItemId: 'item-v1' }]);
  });

  // An update with nothing new is still worth doing: the Spotify order may have changed.
  it('still reconciles when every track is already synced', async () => {
    h.fetchAllYoutubePlaylistItems.mockResolvedValue([ytItem('v1', 'One'), ytItem('v2', 'Two')]);
    h.searchTracksForVideos.mockResolvedValue({ videoIds: [], searchResults: [] });

    await run();

    expect(h.reconcilePlaylist).toHaveBeenCalledTimes(1);
    expect(emitted.at(-1)).toContain('https://www.youtube.com/playlist?list=EXISTING_PL');
  });
});

/**
 * The guard the code's own comment argues for: a read that half-worked must not be treated as the
 * truth about the playlist. Falling through to CREATE would build a second copy; reconciling from
 * a partial item list would treat the videos it never saw as missing, re-insert them, and scramble
 * the order. A transient failure must not be able to corrupt the playlist.
 */
describe('when the existing playlist cannot be read', () => {
  it('throws rather than creating a duplicate playlist', async () => {
    h.findSyncedYoutubePlaylist.mockRejectedValue(new Error('YouTube said no'));

    await expect(run()).rejects.toThrow('YouTube said no');

    expect(youtube.playlists.insert).not.toHaveBeenCalled();
    expect(h.reconcilePlaylist).not.toHaveBeenCalled();
  });

  it('throws rather than reconciling from a half-fetched item list', async () => {
    h.findSyncedYoutubePlaylist.mockResolvedValue({ id: 'EXISTING_PL' });
    h.fetchAllYoutubePlaylistItems.mockRejectedValue(new Error('page 2 failed'));

    await expect(run()).rejects.toThrow('page 2 failed');

    expect(h.reconcilePlaylist).not.toHaveBeenCalled();
  });
});

describe('the batch size', () => {
  const trackLimitFor = async (batchSizeRaw: string | undefined) => {
    await run({ batchSizeRaw });
    return h.searchTracksForVideos.mock.calls[0]![0].length;
  };

  it('defaults to one track', async () => {
    expect(await trackLimitFor(undefined)).toBe(1);
  });

  it('takes a number', async () => {
    expect(await trackLimitFor('2')).toBe(2);
  });

  it('takes every track when asked for all', async () => {
    expect(await trackLimitFor('all')).toBe(2);
  });

  // A playlist Spotify reports no total for must not silently sync one track.
  it('falls back to a large limit when all is asked for and the total is unknown', async () => {
    h.getPlaylist.mockResolvedValue({
      id: PLAYLIST_ID,
      name: 'My Playlist',
      ownerId: 'me',
      trackTotal: 0,
      spotifyUrl: 'u',
    });

    expect(await trackLimitFor('all')).toBe(2);
  });
});

describe('what counts as a track', () => {
  it('skips items that are not tracks, like podcast episodes', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      spotifyTrack('t1', 'One'),
      { track: { id: 'e1', name: 'An Episode', type: 'episode' } },
      { track: null },
    ]);

    await run({ batchSizeRaw: 'all' });

    expect(h.searchTracksForVideos.mock.calls[0]![0]).toHaveLength(1);
  });

  it('says so, and writes nothing, when there is nothing playable', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([{ track: null }]);

    await run();

    expect(emitted.at(-1)).toContain('No Tracks Found');
    expect(h.searchTracksForVideos).not.toHaveBeenCalled();
    expect(youtube.playlists.insert).not.toHaveBeenCalled();
  });
});

describe('when no videos could be found', () => {
  beforeEach(() => {
    h.searchTracksForVideos.mockResolvedValue({
      videoIds: [],
      searchResults: [searchResult('t1', 'One', false)],
    });
  });

  it('does not create an empty playlist', async () => {
    await run();

    expect(emitted.at(-1)).toContain('No videos found');
    expect(youtube.playlists.insert).not.toHaveBeenCalled();
    expect(h.reconcilePlaylist).not.toHaveBeenCalled();
  });
});

/**
 * The user navigated away. Their playlist must not be rewritten for a sync they are not watching -
 * and the search is the long part, so this is where a disconnect lands.
 */
describe('when the client disconnects during the search', () => {
  it('stops before writing anything', async () => {
    const controller = new AbortController();
    h.searchTracksForVideos.mockImplementation(async () => {
      controller.abort();
      return { videoIds: ['v1'], searchResults: [searchResult('t1', 'One', true, 'v1')] };
    });

    await run({ signal: controller.signal });

    expect(youtube.playlists.insert).not.toHaveBeenCalled();
    expect(h.reconcilePlaylist).not.toHaveBeenCalled();
  });
});

describe('the result it reports', () => {
  it('names the tracks it could not find a video for', async () => {
    h.searchTracksForVideos.mockResolvedValue({
      videoIds: ['v1'],
      searchResults: [searchResult('t1', 'One', true, 'v1'), searchResult('t2', 'Two', false)],
    });

    await run({ batchSizeRaw: 'all' });

    expect(progress.at(-1)!.details).toBe('Found 1 out of 2 tracks');
    expect(emitted.at(-1)).toContain('Two');
  });

  it('says when the sync was limited to a batch', async () => {
    h.searchTracksForVideos.mockResolvedValue({
      videoIds: ['v1'],
      searchResults: [searchResult('t1', 'One', true, 'v1')],
    });

    await run({ batchSizeRaw: '1' });

    expect(progress.at(-1)!.details).toBe('Found 1 out of 1 tracks (limited from 2 total)');
  });

  it('refreshes the details panel from the playlist it just wrote', async () => {
    await run();

    expect(h.fetchPlaylistDetails).toHaveBeenCalledWith('sp-token', youtube, PLAYLIST_ID, 'NEW_PL');
  });
});

describe('the progress it streams', () => {
  it('starts before anything is fetched', async () => {
    await run();

    expect(progress[0]).toMatchObject({ type: 'progress', message: 'Starting sync...' });
  });

  it('reaches the end of the search phase before touching the playlist', async () => {
    await run();

    const searchDone = progress.find((p) => p.message.startsWith('Found 2 music videos'));
    expect(searchDone).toMatchObject({ percentage: 70 });
  });

  it('reports the playlist phase between the search phase and done', async () => {
    h.reconcilePlaylist.mockImplementation(async (_yt, _id, _desired, _current, onProgress) => {
      await onProgress?.(1, 2);
      return { inserted: 2, moved: 0, deleted: 0 };
    });

    await run();

    expect(progress.find((p) => p.message === 'Adding videos to playlist')).toMatchObject({
      percentage: 85,
    });
  });
});
