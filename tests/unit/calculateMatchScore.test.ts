/**
 * Golden-master / characterization tests for the scoring engine.
 *
 * These pin the CURRENT behavior of calculateMatchScore, parseViewCount, and the
 * conflict resolution in optimalTrackMatching so the upcoming matching/persistence
 * refactor can change *association* without silently changing *scoring*.
 */

import { describe, it, expect } from 'vitest';
import { calculateMatchScore, optimalTrackMatching } from '../../src/sync/trackMatching';

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

  // The channel must NOT contain the artist name. isKnownLabel() is the right-hand side of
  // `channel.includes(normalizedArtist) || isKnownLabel(channel)`, so a channel like
  // "RadioheadVEVO" satisfies the LEFT side and short-circuits the label check away entirely -
  // which is how isKnownLabel came to be replaceable with `return false` while every test passed.
  it.each([
    ['Universal Music Group', 'universal'],
    ['SonyMusic', 'sony'],
    ['Warner Records', 'warner'],
    ['Nuclear Blast Records', 'nuclear blast'],
    ['RocNationVEVO', 'vevo'],
  ])('grants the official-video bonus via a known label channel: %s', (channelTitle) => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Creep (Official Music Video)', channelTitle }),
    );
    expect(breakdown.components.officialVideo).toBe(0.3);
  });

  it('withholds the official-video bonus when the channel is neither the artist nor a label', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Creep (Official Music Video)', channelTitle: 'SomeRandomUploader' }),
    );
    expect(breakdown.components.officialVideo).toBeUndefined();
  });

  it.each([
    'Creep (Official Video)',
    'Creep (Official Music Video)',
    'Creep (Official HD Video)',
    'Creep (Official Lyric Video)',
    'Creep (Official Lyrics)',
    'Creep (Official Audio)',
    'Creep (Official Visualizer)',
    'Creep (Official Video Clip)',
  ])('recognises common official-video title variants: %s', (title) => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title, channelTitle: 'RadioheadVEVO' }),
    );
    expect(breakdown.components.officialVideo).toBe(0.3);
  });

  it('does not treat "unofficial video" as official', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Creep (Unofficial Video)', channelTitle: 'RadioheadVEVO' }),
    );
    expect(breakdown.components.officialVideo).toBeUndefined();
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

describe('titles that normalize to an empty core', () => {
  const officialVideo = {
    id: 'v1',
    title: 'Nirvana - Smells Like Teen Spirit (Official Music Video)',
    description: '',
    channelTitle: 'NirvanaVEVO',
  };

  // extractCoreTitle/normalizeText can reduce a name to ''. `x.includes('')` is always true in JS,
  // so an empty core used to score 0.6 (+0.15 artist) against EVERY video - over the 0.4 threshold.
  it.each(['(Live)', '   ', '...', '(Official Video)'])(
    'does not award a core-title match for %j',
    (name) => {
      const { breakdown } = calculateMatchScore({ id: 't', name, artist: '???' }, officialVideo);
      expect(breakdown.components.coreMatch).toBeUndefined();
      expect(breakdown.components.artistBonus).toBeUndefined();
    },
  );

  it('scores below the 0.4 match threshold even against a hugely popular official video', () => {
    const babyShark = {
      id: 'v2',
      title: 'Baby Shark Dance (Official Video)',
      description: '',
      channelTitle: 'Pinkfong',
      viewCount: 15_000_000_000,
    };
    // Quality bonuses are tiebreakers, not evidence: officialVideo (0.3) + viewCount (0.1) must not
    // reach 0.4 on their own for a track whose title cannot be read.
    const { score } = calculateMatchScore({ id: 't', name: '(Live)', artist: '???' }, babyShark);
    expect(score).toBeLessThan(0.4);
  });

  it('does not let a junk track steal the video that belongs to a real track', () => {
    const result = optimalTrackMatching(
      [
        { id: 'junk', name: '(Live)', artist: '...' },
        { id: 'real', name: 'Smells Like Teen Spirit', artist: 'Nirvana' },
      ],
      [officialVideo],
    );
    expect(result.matches.get('real')?.id).toBe('v1');
    expect(result.matches.has('junk')).toBe(false);
  });
});

describe('optimalTrackMatching contested tracks', () => {
  const gottaHaveIt = {
    id: 'v1',
    title: 'Jay Z Kanye West - Gotta Have It (Official Video)',
    description: '',
    channelTitle: 'RocNationVevo',
  };

  it('marks the loser contested when the same song appears twice under different track ids', () => {
    // One video, two Spotify entries for the same song: sync's one-video-one-slot rule means the
    // loser can never link, so it must not be counted as fixable drift.
    const result = optimalTrackMatching(
      [
        { id: 'tA', name: 'Gotta Have It', artist: 'JAY-Z' },
        { id: 'tB', name: 'Gotta Have It', artist: 'JAY-Z' },
      ],
      [gottaHaveIt],
    );

    expect(result.matches.has('tA')).toBe(true);
    expect(result.matches.has('tB')).toBe(false);
    expect([...result.contested]).toEqual(['tB']);
  });

  it('does NOT mark a different song contested just for losing a weak fuzzy near-miss', () => {
    // "Song B" fuzzy-scores ~0.42 against a "Song A" video - over the 0.4 bar, but it is not the
    // same song. A search can still find it its own video, so this is real, fixable drift.
    const result = optimalTrackMatching(
      [
        { id: 't1', name: 'Song A', artist: 'Artist' },
        { id: 't2', name: 'Song B', artist: 'Artist' },
      ],
      [{ id: 'vA', title: 'Song A', description: '', channelTitle: 'c' }],
    );

    expect(result.matches.has('t2')).toBe(false);
    expect(result.contested.size).toBe(0);
  });
});

/**
 * Component-level tests.
 *
 * Mutation testing showed the scoring components were almost entirely unpinned: the tests above
 * assert coarse outcomes ("the right video won") while every bonus underneath could be changed,
 * deleted or negated with nothing failing. `fuzzySimilarity` and `wordMatching` were not named in
 * a single test.
 *
 * These assert `components` as a WHOLE object, which also pins the components that must NOT be
 * present - a bonus leaking into a branch it does not belong to fails here for free.
 */
describe('calculateMatchScore components', () => {
  it('awards only coreMatch when the artist appears nowhere in the video title', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Creep' }),
    );

    expect(breakdown.components).toEqual({ coreMatch: 0.6 });
    expect(breakdown.totalScore).toBe(0.6);
  });

  it('adds the 0.15 artist bonus when the artist is in the title', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep' }),
    );

    expect(breakdown.components).toEqual({ coreMatch: 0.6, artistBonus: 0.15 });
  });

  // Strategy 2 needs a title where NEITHER string contains the other (a substring either way is
  // Strategy 1's job) but similarity still clears 0.8 - i.e. a typo, not a suffix. Transposing two
  // letters gives distance 2 over 16 chars => 0.875.
  it('falls back to fuzzySimilarity, scored as 0.5 x similarity', () => {
    const { breakdown } = calculateMatchScore(
      track('Paranoid Android', 'Radiohead'),
      video({ title: 'Paranoid Andorid' }),
    );

    expect(breakdown.components.coreMatch).toBeUndefined();
    expect(breakdown.components).toEqual({ fuzzySimilarity: 0.5 * 0.875 });
    // The score IS the component - pins `score += x` against `score -= x`.
    expect(breakdown.totalScore).toBeCloseTo(0.5 * 0.875, 10);
  });

  it('withholds fuzzySimilarity when similarity is at or below 0.8', () => {
    const { breakdown } = calculateMatchScore(
      track('Paranoid Android', 'Radiohead'),
      video({ title: 'Paranoxx Xndorid' }),
    );

    expect(breakdown.components.fuzzySimilarity).toBeUndefined();
  });

  // Strategy 3: too dissimilar for fuzzy, but most significant words are present.
  it('falls back to wordMatching, scored as 0.4 x the matched-word ratio', () => {
    const { breakdown } = calculateMatchScore(
      track('Karma Police Reprise', 'Radiohead'),
      video({ title: 'Karma Police Instrumental Cover Take Two' }),
    );

    expect(breakdown.components.coreMatch).toBeUndefined();
    expect(breakdown.components.fuzzySimilarity).toBeUndefined();
    // 2 of 3 words (karma, police) match => 0.4 * 2/3
    expect(breakdown.components.wordMatching).toBeCloseTo(0.4 * (2 / 3), 10);
  });

  it('withholds wordMatching when at or below half the words match', () => {
    const { breakdown } = calculateMatchScore(
      track('Karma Police Reprise Overture', 'Radiohead'),
      video({ title: 'Karma Police Symphonic Rendition Live Take' }),
    );

    // 2 of 4 = 0.5, and the gate is `> 0.5` - pins the boundary.
    expect(breakdown.components.wordMatching).toBeUndefined();
  });

  it('applies the secondary 0.1 artist bonus when only the artist matches', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead interview backstage' }),
    );

    expect(breakdown.components).toEqual({ artistBonus: 0.1 });
  });

  it('does not stack the secondary artist bonus on top of the 0.15 one', () => {
    const { breakdown } = calculateMatchScore(
      track('Creep', 'Radiohead'),
      video({ title: 'Radiohead - Creep' }),
    );

    expect(breakdown.components.artistBonus).toBe(0.15);
  });
});

/**
 * The hasTextSignal gate. officialVideo (0.3) + viewCountBonus (0.1) reach the 0.4 match threshold
 * on their own, so without it a track whose title cannot be read would match any popular official
 * video. These pin that the quality bonuses are tiebreakers, never evidence.
 */
describe('calculateMatchScore quality bonuses require a text signal', () => {
  const popularOfficial = {
    id: 'v1',
    title: 'Some Other Song (Official Video)',
    description: '',
    channelTitle: 'Universal Music Group',
    viewCount: 10_000_000,
  };

  it('withholds officialVideo and viewCountBonus with no text signal at all', () => {
    const { breakdown } = calculateMatchScore(track('Creep', 'Radiohead'), popularOfficial);

    expect(breakdown.components).toEqual({});
    expect(breakdown.totalScore).toBe(0);
  });

  it.each([
    ['coreMatch', 'Creep (Official Video)'],
    ['artistBonus', 'Radiohead interview (Official Video)'],
  ])('grants the quality bonuses once there IS a %s signal', (_component, title) => {
    const { breakdown } = calculateMatchScore(track('Creep', 'Radiohead'), {
      ...popularOfficial,
      title,
    });

    expect(breakdown.components.officialVideo).toBe(0.3);
    expect(breakdown.components.viewCountBonus).toBeGreaterThan(0);
  });

  it('scores the view bonus as log10(views)/100', () => {
    const { breakdown } = calculateMatchScore(track('Creep', 'Radiohead'), {
      id: 'v1',
      title: 'Radiohead - Creep',
      description: '',
      viewCount: 1_000_000,
    });

    // log10(1e6) = 6 => 0.06, under the 0.1 cap.
    expect(breakdown.components.viewCountBonus).toBeCloseTo(0.06, 10);
  });

  it('caps the view bonus at 0.1 however large the count', () => {
    const { breakdown } = calculateMatchScore(track('Creep', 'Radiohead'), {
      id: 'v1',
      title: 'Radiohead - Creep',
      description: '',
      viewCount: 1_000_000_000_000_000,
    });

    expect(breakdown.components.viewCountBonus).toBe(0.1);
  });
});
