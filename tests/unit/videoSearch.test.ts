/**
 * Unit tests for the extracted STEP 3 search phase (searchTracksForVideos):
 * order preservation, found/not-found handling, the update-mode position offset,
 * and skipping non-track items.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ searchMusicVideo: vi.fn() }));
vi.mock('../../src/utils/youtubeScraper', () => ({ searchMusicVideo: h.searchMusicVideo }));

import { searchTracksForVideos } from '../../src/services/videoSearch';

const item = (id: string, name: string, type = 'track') =>
  ({ track: { id, name, type, artists: [{ name: 'Artist' }] } });

const baseOpts = {
  isUpdateMode: false,
  existingVideoCount: 0,
  totalTrackCount: 0, // 0 -> skip the inter-search delay, keeps tests fast
  searchPhaseWeight: 0.7,
  emitProgress: () => {}
};

describe('searchTracksForVideos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns found video IDs in track order with create-mode positions', async () => {
    h.searchMusicVideo.mockImplementation((_a: string, song: string) =>
      Promise.resolve(song === 'One' ? 'v1' : song === 'Two' ? 'v2' : null));

    const { videoIds, searchResults } = await searchTracksForVideos([item('t1', 'One'), item('t2', 'Two')], baseOpts);

    expect(videoIds).toEqual(['v1', 'v2']);
    expect(searchResults.map(r => [r.spotifyTrackId, r.found, r.videoId, r.spotifyPosition]))
      .toEqual([['t1', true, 'v1', 0], ['t2', true, 'v2', 1]]);
  });

  it('offsets positions by existing video count in update mode', async () => {
    h.searchMusicVideo.mockResolvedValue('vX');
    const { searchResults } = await searchTracksForVideos(
      [item('t1', 'One'), item('t2', 'Two')],
      { ...baseOpts, isUpdateMode: true, existingVideoCount: 3 }
    );
    expect(searchResults.map(r => r.spotifyPosition)).toEqual([3, 4]);
  });

  it('records not-found tracks without adding to videoIds', async () => {
    h.searchMusicVideo.mockResolvedValue(null);
    const { videoIds, searchResults } = await searchTracksForVideos([item('t1', 'One')], baseOpts);
    expect(videoIds).toEqual([]);
    expect(searchResults[0]).toMatchObject({ found: false, spotifyTrackId: 't1' });
    expect(searchResults[0].videoId).toBeUndefined();
  });

  it('skips items that are not of type track', async () => {
    h.searchMusicVideo.mockResolvedValue('v1');
    const { videoIds } = await searchTracksForVideos(
      [item('t1', 'One', 'episode'), item('t2', 'Two')],
      baseOpts
    );
    expect(videoIds).toEqual(['v1']);
    expect(h.searchMusicVideo).toHaveBeenCalledTimes(1);
  });

  it('continues past a search error, recording the track as not found', async () => {
    h.searchMusicVideo
      .mockRejectedValueOnce(new Error('scrape failed'))
      .mockResolvedValueOnce('v2');
    const { videoIds, searchResults } = await searchTracksForVideos([item('t1', 'One'), item('t2', 'Two')], baseOpts);
    expect(videoIds).toEqual(['v2']);
    expect(searchResults[0].found).toBe(false);
    expect(searchResults[1].found).toBe(true);
  });
});
