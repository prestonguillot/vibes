/**
 * Unit tests for the extracted STEP 3 search phase (searchTracksForVideos):
 * order preservation, found/not-found handling, the update-mode position offset,
 * and skipping non-track items.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ searchMusicVideo: vi.fn() }));
vi.mock('../../src/youtube/scraper', () => ({ searchMusicVideo: h.searchMusicVideo }));

import { searchTracksForVideos } from '../../src/sync/videoSearch';

const item = (id: string, name: string, type = 'track') => ({
  track: { id, name, type, artists: [{ name: 'Artist' }] },
});

const baseOpts = {
  isUpdateMode: false,
  existingVideoCount: 0,
  totalTrackCount: 0, // 0 -> skip the inter-search delay, keeps tests fast
  searchPhaseWeight: 0.7,
  emitProgress: () => {},
};

// File scope, so every block starts with a clean mock - not just the first describe.
beforeEach(() => vi.clearAllMocks());

describe('searchTracksForVideos', () => {
  it('returns found video IDs in track order with create-mode positions', async () => {
    h.searchMusicVideo.mockImplementation((_a: string, song: string) =>
      Promise.resolve(song === 'One' ? 'v1' : song === 'Two' ? 'v2' : null),
    );

    const { videoIds, searchResults } = await searchTracksForVideos(
      [item('t1', 'One'), item('t2', 'Two')],
      baseOpts,
    );

    expect(videoIds).toEqual(['v1', 'v2']);
    expect(
      searchResults.map((r) => [r.spotifyTrackId, r.found, r.videoId, r.spotifyPosition]),
    ).toEqual([
      ['t1', true, 'v1', 0],
      ['t2', true, 'v2', 1],
    ]);
  });

  it('offsets positions by existing video count in update mode', async () => {
    h.searchMusicVideo.mockResolvedValue('vX');
    const { searchResults } = await searchTracksForVideos([item('t1', 'One'), item('t2', 'Two')], {
      ...baseOpts,
      isUpdateMode: true,
      existingVideoCount: 3,
    });
    expect(searchResults.map((r) => r.spotifyPosition)).toEqual([3, 4]);
  });

  it('records not-found tracks without adding to videoIds', async () => {
    h.searchMusicVideo.mockResolvedValue(null);
    const { videoIds, searchResults } = await searchTracksForVideos([item('t1', 'One')], baseOpts);
    expect(videoIds).toEqual([]);
    expect(searchResults[0]).toMatchObject({ found: false, spotifyTrackId: 't1' });
    expect(searchResults[0]!.videoId).toBeUndefined();
  });

  it('skips items that are not of type track', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');
    const { videoIds } = await searchTracksForVideos(
      [item('t1', 'One', 'episode'), item('t2', 'Two')],
      baseOpts,
    );
    expect(videoIds).toEqual(['v1']);
    expect(h.searchMusicVideo).toHaveBeenCalledTimes(1);
  });

  it('continues past a search error, recording the track as not found', async () => {
    h.searchMusicVideo
      .mockRejectedValueOnce(new Error('scrape failed'))
      .mockResolvedValueOnce('v2');
    const { videoIds, searchResults } = await searchTracksForVideos(
      [item('t1', 'One'), item('t2', 'Two')],
      baseOpts,
    );
    expect(videoIds).toEqual(['v2']);
    expect(searchResults[0]!.found).toBe(false);
    expect(searchResults[1]!.found).toBe(true);
  });
});

/**
 * Progress reporting, the abort signal, and rate limiting.
 *
 * baseOpts stubs emitProgress and sets totalTrackCount: 0 to keep the other tests fast, which
 * leaves the progress payloads and the rate-limit branch unobserved. These watch both.
 */
describe('searchTracksForVideos progress reporting', () => {
  const withProgress = (over: Partial<typeof baseOpts> = {}) => {
    const emitProgress = vi.fn();
    return { emitProgress, opts: { ...baseOpts, ...over, emitProgress } };
  };

  it('reports each track with its position and the searching message', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');
    const { emitProgress, opts } = withProgress();

    await searchTracksForVideos([item('t1', 'One'), item('t2', 'Two')], opts);

    // Asserted whole: a payload field that silently goes missing is a blank progress bar.
    expect(emitProgress).toHaveBeenNthCalledWith(1, {
      type: 'progress',
      message: 'Finding music videos',
      details: 'Searching for "One" by Artist... (1/2)',
      currentTrack: 1,
      totalTracks: 2,
      currentSong: 'One',
      currentArtist: 'Artist',
      percentage: 0,
    });
    expect(emitProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ currentTrack: 2 }));
  });

  it('scales the percentage by the search phase weight', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');
    const { emitProgress, opts } = withProgress({ searchPhaseWeight: 0.7 });

    await searchTracksForVideos([item('t1', 'One'), item('t2', 'Two')], opts);

    // Track 2 of 2 => (1/2) * 0.7 = 35%.
    expect(emitProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ percentage: 35 }));
  });

  it('says "Checking for playlist updates" in update mode', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');
    const { emitProgress, opts } = withProgress({ isUpdateMode: true, existingVideoCount: 5 });

    await searchTracksForVideos([item('t1', 'One')], opts);

    expect(emitProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: 'Checking for playlist updates',
        details: 'Analyzing "One" by Artist... (1/1)',
      }),
    );
  });

  it('emits an error payload when a search throws, and keeps going', async () => {
    h.searchMusicVideo
      .mockRejectedValueOnce(new Error('scrape failed'))
      .mockResolvedValueOnce('v2');
    const { emitProgress, opts } = withProgress();

    const { videoIds, searchResults } = await searchTracksForVideos(
      [item('t1', 'One'), item('t2', 'Two')],
      opts,
    );

    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Error searching for video' }),
    );
    // The failed track is recorded as not-found; the run continues to the next one.
    expect(searchResults[0]).toMatchObject({ found: false, spotifyTrackId: 't1' });
    expect(videoIds).toEqual(['v2']);
  });

  it('falls back to "Unknown Artist" when a track has no artists', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');
    const { emitProgress, opts } = withProgress();

    await searchTracksForVideos(
      [{ track: { id: 't1', name: 'One', type: 'track', artists: [] } }],
      opts,
    );

    expect(emitProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ currentArtist: 'Unknown Artist' }),
    );
    expect(h.searchMusicVideo).toHaveBeenCalledWith('Unknown Artist', 'One');
  });
});

describe('searchTracksForVideos abort handling', () => {
  it('searches nothing when the signal is already aborted', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');
    const controller = new AbortController();
    controller.abort();

    const { videoIds } = await searchTracksForVideos([item('t1', 'One')], {
      ...baseOpts,
      signal: controller.signal,
    });

    expect(h.searchMusicVideo).not.toHaveBeenCalled();
    expect(videoIds).toEqual([]);
  });

  it('stops mid-run once the client disconnects', async () => {
    const controller = new AbortController();
    h.searchMusicVideo.mockImplementation(async () => {
      controller.abort(); // the client goes away during the first search
      return 'v1';
    });

    const { searchResults } = await searchTracksForVideos([item('t1', 'One'), item('t2', 'Two')], {
      ...baseOpts,
      signal: controller.signal,
    });

    expect(searchResults).toHaveLength(1); // track 2 never searched
  });
});

describe('searchTracksForVideos rate limiting', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // baseOpts uses totalTrackCount: 0 to skip this branch entirely, so it had never run.
  it('waits between searches while there are more tracks to come', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');

    const work = searchTracksForVideos([item('t1', 'One'), item('t2', 'Two')], {
      ...baseOpts,
      totalTrackCount: 2,
    });
    const settled = work.then((r) => r);
    await vi.advanceTimersByTimeAsync(1000);

    expect((await settled).videoIds).toEqual(['v1', 'v1']);
  });

  it('does not wait after the final track', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');

    // One track, totalTrackCount 1: searchCount (1) is not < 1, so no delay is scheduled and this
    // resolves without any timer being advanced at all.
    await expect(
      searchTracksForVideos([item('t1', 'One')], { ...baseOpts, totalTrackCount: 1 }),
    ).resolves.toMatchObject({ videoIds: ['v1'] });
  });
});
