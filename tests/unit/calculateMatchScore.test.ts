/**
 * Golden-master / characterization tests for the scoring engine.
 *
 * These pin the CURRENT behavior of calculateMatchScore, parseViewCount, and the
 * conflict resolution in optimalTrackMatching so the upcoming matching/persistence
 * refactor can change *association* without silently changing *scoring*.
 */

import { describe, it, expect } from 'vitest';
import { calculateMatchScore, optimalTrackMatching } from '../../src/utils/trackMatching';

const track = (name: string, artist: string) => ({ id: `${name}-${artist}`, name, artist });
const video = (
  over: Partial<{ id: string; title: string; description: string; channelTitle: string }>,
) => ({
  id: over.id ?? 'v1',
  title: over.title ?? '',
  description: over.description ?? '',
  channelTitle: over.channelTitle,
});

describe('calculateMatchScore (golden master)', () => {
  it('scores an exact core-title match at 0.6 with a 0.15 artist bonus', () => {
    const { score, breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep' }),
    );
    expect(breakdown.components.coreMatch).toBe(0.6);
    expect(breakdown.components.artistBonus).toBe(0.15);
    expect(score).toBeCloseTo(0.75, 5);
  });

  it('adds the 0.3 official-video bonus when title says official and channel matches the artist', () => {
    const { score, breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep (Official Video)', channelTitle: 'Radiohead' }),
    );
    expect(breakdown.components.officialVideo).toBe(0.3);
    // 0.6 core + 0.15 artist + 0.3 official = 1.05, capped at 1.0
    expect(score).toBe(1.0);
  });

  it('grants the official-video bonus for a known label channel (e.g. VEVO)', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Creep (Official Music Video)', channelTitle: 'RadioheadVEVO' }),
    );
    expect(breakdown.components.officialVideo).toBe(0.3);
  });

  it('does NOT grant the official bonus when the channel is unrelated (no view-count shortcut anymore)', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Creep (Official Music Video)', channelTitle: 'SomeRandomUploader' }),
    );
    expect(breakdown.components.officialVideo).toBeUndefined();
  });

  it('ignores view counts entirely (no view-count or live-performance components exist)', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep (Live at Glastonbury)' }),
    );
    // Live/view bonuses were removed; only the stable components remain.
    expect(breakdown.components).not.toHaveProperty('viewCount');
    expect(breakdown.components).not.toHaveProperty('livePerformance');
  });

  it('caps the total score at 1.0 and reports 5 stars at the cap', () => {
    // 0.6 core + 0.15 artist + 0.3 official = 1.05, capped at 1.0 (no view count needed).
    const { score, breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep (Official Video)', channelTitle: 'Radiohead' }),
    );
    expect(score).toBe(1.0);
    expect(breakdown.stars).toBe(5);
    expect(breakdown.totalScore).toBe(1.0);
  });

  it('returns a low score and no core/official components for an unrelated video', () => {
    const { score, breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Totally Different Cooking Tutorial' }),
    );
    expect(breakdown.components.coreMatch).toBeUndefined();
    expect(breakdown.components.officialVideo).toBeUndefined();
    expect(score).toBeLessThan(0.4);
  });

  it('derives stars as score*5 and a hex/rgb color string', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep' }),
    );
    // stars = Math.round(0.75 * 5 * 10) / 10 = Math.round(37.5) / 10 = 3.8
    expect(breakdown.stars).toBe(3.8);
    expect(breakdown.color).toMatch(/^rgb\(/);
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
      video({ id: 'b', title: 'Artist - Song B' }),
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
      [video({ id: 'x', title: 'Unrelated Gardening Video' })],
    );
    expect(matches.size).toBe(0);
  });
});
