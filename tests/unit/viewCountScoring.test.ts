/**
 * Tests for the re-introduced view-count signal: parseViewCount (scraper) and the
 * small, capped popularity nudge in calculateMatchScore. The nudge applies only
 * when a view count is provided (search-result candidates), so the playlist-
 * matching path stays deterministic - that's covered by the golden-master tests.
 */

import { describe, it, expect } from 'vitest';
import { calculateMatchScore } from '../../src/sync/trackMatching';
import { parseViewCount } from '../../src/youtube/scraper';

const track = { id: 't', name: 'Song Name', artist: 'Artist' };
const baseVideo = { id: 'v', title: 'Song Name', description: '', channelTitle: 'Some Channel' };

describe('parseViewCount', () => {
  it('parses plain numbers with commas', () => {
    expect(parseViewCount('1,234,567 views')).toBe(1234567);
  });

  it('parses K / M / B suffixes', () => {
    expect(parseViewCount('500K views')).toBe(500000);
    expect(parseViewCount('1.5M views')).toBe(1500000);
    expect(parseViewCount('2B views')).toBe(2000000000);
  });

  it('returns 0 for unknown / empty values', () => {
    expect(parseViewCount('No views')).toBe(0);
    expect(parseViewCount('Unknown Views')).toBe(0);
    expect(parseViewCount(undefined)).toBe(0);
    expect(parseViewCount('')).toBe(0);
  });
});

describe('calculateMatchScore view-count nudge', () => {
  it('adds no bonus when viewCount is absent (deterministic path unchanged)', () => {
    const { breakdown } = calculateMatchScore(track, baseVideo);
    expect(breakdown.components.viewCountBonus).toBeUndefined();
  });

  it('adds a small bonus when a view count is present', () => {
    const without = calculateMatchScore(track, baseVideo).score;
    const withViews = calculateMatchScore(track, { ...baseVideo, viewCount: 1_000_000 });
    expect(withViews.score).toBeGreaterThan(without);
    expect(withViews.breakdown.components.viewCountBonus).toBeGreaterThan(0);
    expect(withViews.breakdown.components.viewCountBonus).toBeLessThanOrEqual(0.1);
  });

  it('caps the bonus at 0.1 for enormous view counts', () => {
    const { breakdown } = calculateMatchScore(track, {
      ...baseVideo,
      viewCount: 1_000_000_000_000,
    });
    expect(breakdown.components.viewCountBonus).toBe(0.1);
  });

  it('breaks a tie toward the more-viewed of two equal-text matches', () => {
    const low = calculateMatchScore(track, { ...baseVideo, id: 'a', viewCount: 1000 }).score;
    const high = calculateMatchScore(track, { ...baseVideo, id: 'b', viewCount: 50_000_000 }).score;
    expect(high).toBeGreaterThan(low);
  });

  it('does not let views rescue a weak text match above the link threshold', () => {
    const poor = calculateMatchScore(
      { id: 't', name: 'Completely Different Title', artist: 'X' },
      {
        id: 'v',
        title: 'Unrelated Video',
        description: '',
        channelTitle: 'C',
        viewCount: 1_000_000_000,
      },
    );
    expect(poor.score).toBeLessThan(0.4);
  });
});
