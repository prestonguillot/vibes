/**
 * Direct tests for the pure helpers behind the matcher.
 *
 * These were reachable only through calculateMatchScore, which meant nothing pinned them: mutation
 * testing showed ~90 surviving mutants in extractCoreTitle's metadata regexes alone, every boundary
 * in scoreToColor (asserted only as `toMatch(/^rgb\(/)`), and `Math.min -> Math.max` inside the
 * Levenshtein distance. A wrong answer here is not an error, it is a wrong video.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateStringSimilarity,
  extractCoreTitle,
  isKnownLabel,
  normalizeText,
  scoreToColor,
} from '../../src/sync/trackMatching';

describe('normalizeText', () => {
  it('lowercases', () => {
    expect(normalizeText('CREEP')).toBe('creep');
  });

  it('replaces punctuation with spaces and collapses the result', () => {
    expect(normalizeText('Creep!!! (Live)')).toBe('creep live');
  });

  it('strips collaboration markers', () => {
    expect(normalizeText('Song ft Artist')).toBe('song artist');
    expect(normalizeText('Song feat Artist')).toBe('song artist');
    expect(normalizeText('Song featuring Artist')).toBe('song artist');
  });

  // \b(ft|feat|featuring)\b - only whole words, so a title like "Aftermath" survives intact.
  it('does not strip ft/feat inside a longer word', () => {
    expect(normalizeText('Aftermath')).toBe('aftermath');
    expect(normalizeText('Defeat')).toBe('defeat');
  });

  it('trims', () => {
    expect(normalizeText('  Creep  ')).toBe('creep');
  });
});

describe('extractCoreTitle', () => {
  it.each([
    ['Creep (Remaster)', 'creep'],
    ['Creep (Live)', 'creep'],
    ['Creep - Remastered 2016', 'creep'],
    ['Creep - 2016 Remaster', 'creep'],
    ['Creep (2016 Remaster)', 'creep'],
    ['Creep [2016 Remaster]', 'creep'],
    ['Creep (with Thom Yorke)', 'creep'],
    ['Creep (feat. Thom Yorke)', 'creep'],
    ['Creep (feat Thom Yorke)', 'creep'],
    ['Creep - Live at Glastonbury', 'creep'],
    ['Creep (Live at Glastonbury)', 'creep'],
    ['Creep - Acoustic', 'creep'],
    ['Creep - Radio Edit', 'creep'],
    ['Creep - Instrumental', 'creep'],
  ])('strips metadata: %s -> %s', (title, expected) => {
    expect(extractCoreTitle(title)).toBe(expected);
  });

  // Regression: a metadata pattern used to strip ", Pt. 2" outright, so every part of a track
  // collapsed to the same core - "Song, Pt. 2" and "Song, Pt. 3" both became "song" and contested
  // each other's video at an identical 0.6. The part number is the whole distinction.
  it.each([
    ['Song, Pt. 2', 'song pt 2'],
    ['Song, Pt. 3', 'song pt 3'],
    ['Song Pt. 2', 'song pt 2'],
    ['Song, Pt. 2 (Official Video)', 'song pt 2'],
  ])('keeps the part number: %s -> %s', (title, expected) => {
    expect(extractCoreTitle(title)).toBe(expected);
  });

  it('keeps different parts of a track distinguishable', () => {
    expect(extractCoreTitle('Song, Pt. 2')).not.toBe(extractCoreTitle('Song, Pt. 3'));
  });

  // Multi-word parentheticals are NOT stripped - the bracket regex matches a single keyword. The
  // substring test in calculateMatchScore absorbs the leftover, which is why it never showed up.
  it.each([
    ['Creep (Official Video)', 'creep official video'],
    ['Creep [Official Audio]', 'creep official audio'],
  ])('leaves multi-word parentheticals in the core: %s -> %s', (title, expected) => {
    expect(extractCoreTitle(title)).toBe(expected);
  });

  it('leaves a plain title alone', () => {
    expect(extractCoreTitle('Karma Police')).toBe('karma police');
  });

  // The empty core is load-bearing: `x.includes('')` is always true, so calculateMatchScore
  // guards it - an empty core would otherwise match every video. A single-keyword bracket is the
  // shape that actually empties out.
  it('reduces a title that is nothing but metadata to an empty string', () => {
    expect(extractCoreTitle('(Remaster)')).toBe('');
  });
});

describe('calculateStringSimilarity', () => {
  it('is 1 for identical strings', () => {
    expect(calculateStringSimilarity('creep', 'creep')).toBe(1);
  });

  it('is 1 when both are empty', () => {
    expect(calculateStringSimilarity('', '')).toBe(1);
  });

  it('is 0 when nothing matches', () => {
    expect(calculateStringSimilarity('abc', 'xyz')).toBe(0);
  });

  // The classic Levenshtein fixture: kitten -> sitting is 3 edits. This is what pins the
  // Math.min over the deletion/insertion/substitution costs; Math.max passes every vaguer test.
  it('scores kitten/sitting as 1 - 3/7', () => {
    expect(calculateStringSimilarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7, 10);
  });

  it('scores a single transposition as 1 - 2/len', () => {
    expect(calculateStringSimilarity('android', 'andorid')).toBeCloseTo(1 - 2 / 7, 10);
  });

  it('is symmetric', () => {
    expect(calculateStringSimilarity('kitten', 'sitting')).toBe(
      calculateStringSimilarity('sitting', 'kitten'),
    );
  });

  it('scores a pure suffix by the longer length', () => {
    // 'creeping' vs 'creep' = 3 deletions over 8.
    expect(calculateStringSimilarity('creeping', 'creep')).toBeCloseTo(1 - 3 / 8, 10);
  });
});

describe('isKnownLabel', () => {
  it.each([
    ['radioheadvevo'],
    ['universal music group'],
    ['sonymusic'],
    ['warner records'],
    ['republic records'],
    ['geffen'],
    ['atlantic records'],
    ['island records'],
    ['capitol music'],
    ['elektra'],
    ['mercy'],
    ['roadrunner records'],
    ['nuclear blast'],
    ['metal blade records'],
    ['earache'],
    ['century media'],
    ['prosthetic records'],
    ['relapse records'],
  ])('recognises %s', (channel) => {
    expect(isKnownLabel(channel)).toBe(true);
  });

  it.each([['someguy'], ['topic'], ['music archive'], ['']])('rejects %o', (channel) => {
    expect(isKnownLabel(channel)).toBe(false);
  });
});

describe('scoreToColor', () => {
  // Four ramps meeting at 0.4 / 0.6 / 0.8. Every boundary and every arithmetic term here survived
  // mutation because the only assertion anywhere was `toMatch(/^rgb\(/)`.
  it.each([
    [0, 'rgb(255, 0, 0)'],
    [0.2, 'rgb(255, 68, 0)'],
    [0.399, 'rgb(255, 136, 0)'],
    [0.4, 'rgb(255, 136, 0)'],
    [0.5, 'rgb(255, 196, 0)'],
    [0.599, 'rgb(255, 254, 0)'],
    [0.6, 'rgb(255, 255, 0)'],
    [0.7, 'rgb(172, 255, 0)'],
    [0.799, 'rgb(89, 255, 0)'],
    [0.8, 'rgb(88, 255, 0)'],
    [0.9, 'rgb(44, 255, 0)'],
    [1, 'rgb(0, 255, 0)'],
  ])('maps %s to %s', (score, expected) => {
    expect(scoreToColor(score)).toBe(expected);
  });

  it('goes red at the bottom and green at the top', () => {
    expect(scoreToColor(0)).toBe('rgb(255, 0, 0)');
    expect(scoreToColor(1)).toBe('rgb(0, 255, 0)');
  });
});
