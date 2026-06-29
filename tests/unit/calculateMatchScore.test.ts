/**
 * Golden-master / characterization tests for the scoring engine.
 *
 * These pin the CURRENT behavior of calculateMatchScore, parseViewCount, and the
 * conflict resolution in optimalTrackMatching so the upcoming matching/persistence
 * refactor can change *association* without silently changing *scoring*.
 */

import { describe, it, expect } from 'vitest';
import { calculateMatchScore, optimalTrackMatching } from '../../src/utils/trackMatching';
import { parseViewCount } from '../../src/utils/youtubeScraper';

const track = (name: string, artist: string) => ({ id: `${name}-${artist}`, name, artist });
const video = (over: Partial<{ id: string; title: string; description: string; channelTitle: string; viewCount: number }>) => ({
  id: over.id ?? 'v1',
  title: over.title ?? '',
  description: over.description ?? '',
  channelTitle: over.channelTitle,
  viewCount: over.viewCount
});

describe('calculateMatchScore (golden master)', () => {
  it('scores an exact core-title match at 0.6 with a 0.15 artist bonus', () => {
    const { score, breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep' })
    );
    expect(breakdown.components.coreMatch).toBe(0.6);
    expect(breakdown.components.artistBonus).toBe(0.15);
    expect(score).toBeCloseTo(0.75, 5);
  });

  it('adds the 0.3 official-video bonus when title says official and channel matches the artist', () => {
    const { score, breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep (Official Video)', channelTitle: 'Radiohead' })
    );
    expect(breakdown.components.officialVideo).toBe(0.3);
    // 0.6 core + 0.15 artist + 0.3 official = 1.05, capped at 1.0
    expect(score).toBe(1.0);
  });

  it('treats a >10M view count as a verified channel for the official-video bonus', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Creep (Official Music Video)', channelTitle: 'SomeUploader', viewCount: 20_000_000 })
    );
    expect(breakdown.components.officialVideo).toBe(0.3);
  });

  it('applies the live-performance bonus (0.15) for a live video with >1M views', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep (Live at Glastonbury)', viewCount: 2_000_000 })
    );
    expect(breakdown.components.livePerformance).toBe(0.15);
    expect(breakdown.components.officialVideo).toBeUndefined();
  });

  it('applies view-count bonuses: 0.1 above 5M, 0.05 above 1M', () => {
    const high = calculateMatchScore(track('Creep', 'Radiohead'), video({ title: 'Radiohead - Creep', viewCount: 6_000_000 }));
    expect(high.breakdown.components.viewCount).toBe(0.1);
    const mid = calculateMatchScore(track('Creep', 'Radiohead'), video({ title: 'Radiohead - Creep', viewCount: 2_000_000 }));
    expect(mid.breakdown.components.viewCount).toBe(0.05);
  });

  it('caps the total score at 1.0 and reports 5 stars at the cap', () => {
    const { score, breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep (Official Video)', channelTitle: 'Radiohead', viewCount: 50_000_000 })
    );
    expect(score).toBe(1.0);
    expect(breakdown.stars).toBe(5);
    expect(breakdown.totalScore).toBe(1.0);
  });

  it('returns a low score and no core/official components for an unrelated video', () => {
    const { score, breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Totally Different Cooking Tutorial' })
    );
    expect(breakdown.components.coreMatch).toBeUndefined();
    expect(breakdown.components.officialVideo).toBeUndefined();
    expect(score).toBeLessThan(0.4);
  });

  it('derives stars as score*5 and a hex/rgb color string', () => {
    const { breakdown } = calculateMatchScore(track('Creep', 'Radiohead'), video({ title: 'Radiohead - Creep' }));
    // stars = Math.round(0.75 * 5 * 10) / 10 = Math.round(37.5) / 10 = 3.8
    expect(breakdown.stars).toBe(3.8);
    expect(breakdown.color).toMatch(/^rgb\(/);
  });
});

describe('parseViewCount (golden master)', () => {
  it.each([
    ['1.5M views', 1_500_000],
    ['21.7M views', 21_700_000],
    ['500K views', 500_000],
    ['1,234,567 views', 1_234_567],
    ['742 views', 742],
    ['No views', 0],
    ['', 0]
  ])('parses %j -> %i', (input, expected) => {
    expect(parseViewCount(input)).toBe(expected);
  });
});

describe('optimalTrackMatching conflict resolution (golden master)', () => {
  it('gives a contested video to the higher-scoring track', () => {
    const tracks = [track('Creep', 'Radiohead'), track('Creep Cover', 'Radiohead')];
    const videos = [video({ id: 'real', title: 'Radiohead - Creep' })];

    const { matches } = optimalTrackMatching(tracks, videos);
    // Only one track can win the single video; it must be the exact-title track.
    expect(matches.get('Creep-Radiohead')?.id).toBe('real');
    expect(matches.has('Creep Cover-Radiohead')).toBe(false);
  });

  it('assigns each video at most once across tracks', () => {
    const tracks = [track('Song A', 'Artist'), track('Song B', 'Artist')];
    const videos = [
      video({ id: 'a', title: 'Artist - Song A' }),
      video({ id: 'b', title: 'Artist - Song B' })
    ];
    const { matches } = optimalTrackMatching(tracks, videos);
    const assigned = [matches.get('Song A-Artist')?.id, matches.get('Song B-Artist')?.id];
    expect(new Set(assigned).size).toBe(2);
    expect(assigned).toContain('a');
    expect(assigned).toContain('b');
  });

  it('drops pairs below the 0.4 threshold (no match)', () => {
    const { matches } = optimalTrackMatching(
      [track('Creep', 'Radiohead')],
      [video({ id: 'x', title: 'Unrelated Gardening Video' })]
    );
    expect(matches.size).toBe(0);
  });
});
