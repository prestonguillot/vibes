/**
 * The video picker's search and ranking (src/sync/videoPicker.ts).
 *
 * This is what the user sees when they reject the video sync chose: ten candidates, best first.
 * It was inline in routes/playlistDetails.ts, so the only way to reach it was to stand up a route
 * and a scraper - and the ranking, which is the whole point of the list, was never asserted.
 *
 * calculateMatchScore is real. The ordering is its opinion; asserting it against a fake would test
 * a ranking nobody ships.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ scrapeYouTubeSearch: vi.fn() }));

vi.mock('@/youtube/scraper', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/scraper')>()),
  scrapeYouTubeSearch: h.scrapeYouTubeSearch,
}));

import { pickerQuery, scoreCandidates, searchCandidates } from '@/sync/videoPicker';
import type { SearchResult } from '@/youtube/scraper';
import type { SimplifiedTrack } from '@/sync/trackMatching';

const TRACK: SimplifiedTrack = { id: 't1', name: 'Karma Police', artist: 'Radiohead' };

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  videoId: 'v1',
  title: 'Radiohead - Karma Police',
  duration: '4:24',
  views: '100M views',
  channel: 'RadioheadVEVO',
  ...over,
});

describe('what the picker searches for', () => {
  it('uses the track and artist when the user has not typed a query', () => {
    expect(pickerQuery('Karma Police', 'Radiohead', undefined)).toBe('Karma Police Radiohead');
  });

  it('uses the query the user typed', () => {
    expect(pickerQuery('Karma Police', 'Radiohead', 'karma police live')).toBe('karma police live');
  });

  // A box the user cleared is not a search for nothing - it is no search at all.
  it.each([[''], ['   ']])('falls back when the typed query is %o', (typed) => {
    expect(pickerQuery('Karma Police', 'Radiohead', typed)).toBe('Karma Police Radiohead');
  });

  it('keeps a query the user padded with spaces', () => {
    expect(pickerQuery('Karma Police', 'Radiohead', '  live  ')).toBe('live');
  });
});

describe('the candidate list', () => {
  it('is ranked best first', () => {
    const videos = scoreCandidates(TRACK, [
      result({ videoId: 'bad', title: 'Some Unrelated Song', channel: 'Random' }),
      result({ videoId: 'good', title: 'Radiohead - Karma Police', channel: 'RadioheadVEVO' }),
    ]);

    expect(videos.map((v) => v.id)).toEqual(['good', 'bad']);
    expect(videos[0]!.matchScore_score).toBeGreaterThan(videos[1]!.matchScore_score);
  });

  /**
   * The bug the code comments record: calculateMatchScore only applies its popularity bonus when
   * viewCount is a number. Omitting it does not fail - it silently drops the bonus, so the picker
   * ranks candidates differently from the sync that chose the video in the first place.
   */
  it('parses the view count, so the popularity bonus is applied', () => {
    const [video] = scoreCandidates(TRACK, [result({ views: '1.5M views' })]);

    expect(video!.viewCount).toBe(1_500_000);
  });

  it('scores an unparseable view count rather than dropping the candidate', () => {
    const [video] = scoreCandidates(TRACK, [result({ views: 'no views yet' })]);

    expect(video!.viewCount).toBe(0);
    expect(video!.matchScore_score).toBeGreaterThan(0);
  });

  it('gives each candidate what the modal needs to show it', () => {
    const [video] = scoreCandidates(TRACK, [result({ videoId: 'abc123', views: '100M views' })]);

    expect(video).toMatchObject({
      id: 'abc123',
      title: 'Radiohead - Karma Police',
      description: 'Duration: 4:24 • Views: 100M views',
      thumbnail: 'https://img.youtube.com/vi/abc123/mqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=abc123',
      channelTitle: 'RadioheadVEVO',
    });
  });

  it('reports how the score was reached, not just the number', () => {
    const [video] = scoreCandidates(TRACK, [result()]);

    expect(video!.matchScore.components).toBeDefined();
    expect(video!.matchScore_score).toBeGreaterThan(0);
  });

  it('is empty when the search found nothing', () => {
    expect(scoreCandidates(TRACK, [])).toEqual([]);
  });
});

describe('searching for candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.scrapeYouTubeSearch.mockResolvedValue([result()]);
  });

  it('asks for the query it built, and reports it back for the search box', async () => {
    const { query } = await searchCandidates(TRACK, undefined);

    expect(h.scrapeYouTubeSearch).toHaveBeenCalledWith('Karma Police Radiohead', 10);
    expect(query).toBe('Karma Police Radiohead');
  });

  it('asks for the query the user typed', async () => {
    const { query } = await searchCandidates(TRACK, 'karma police live');

    expect(h.scrapeYouTubeSearch).toHaveBeenCalledWith('karma police live', 10);
    expect(query).toBe('karma police live');
  });

  it('returns the scored candidates', async () => {
    h.scrapeYouTubeSearch.mockResolvedValue([
      result({ videoId: 'bad', title: 'Unrelated', channel: 'Random' }),
      result({ videoId: 'good' }),
    ]);

    const { videos } = await searchCandidates(TRACK, undefined);

    expect(videos.map((v) => v.id)).toEqual(['good', 'bad']);
  });

  it('lets a scraper failure reach the caller, which renders the error', async () => {
    h.scrapeYouTubeSearch.mockRejectedValue(new Error('YouTube blocked us'));

    await expect(searchCandidates(TRACK, undefined)).rejects.toThrow('YouTube blocked us');
  });
});
