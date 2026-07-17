/**
 * Unit tests for ransom-note lettering.
 */

import { describe, it, expect } from 'vitest';
import { toRansom, RANSOM_VARIANTS } from '@/lib/ransom';

describe('toRansom', () => {
  it('cuts a string into one chip per character, preserving the text', () => {
    const chips = toRansom('Your Playlists');

    expect(chips).toHaveLength('Your Playlists'.length);
    expect(chips.map((c) => c.char).join('')).toBe('Your Playlists');
  });

  it('assigns every letter a variant the stylesheet actually defines', () => {
    const chips = toRansom('Your Playlists');

    chips.forEach((chip) => {
      expect(chip.variant).toBeGreaterThanOrEqual(0);
      expect(chip.variant).toBeLessThan(RANSOM_VARIANTS);
      expect(Number.isInteger(chip.variant)).toBe(true);
    });
  });

  it('cuts identically on every call', () => {
    // The whole point of hashing instead of randomising: the page must not reshuffle per request,
    // and visual snapshots must not flake.
    const a = toRansom('Your Playlists');
    const b = toRansom('Your Playlists');

    expect(a).toEqual(b);
  });

  it('marks spaces as gaps rather than letters', () => {
    const chips = toRansom('Your Playlists');

    expect(chips[4]).toMatchObject({ char: ' ', isSpace: true });
    expect(chips.filter((c) => c.isSpace)).toHaveLength(1);
    expect(chips.filter((c) => !c.isSpace).every((c) => c.char.trim() !== '')).toBe(true);
  });

  it('gives a repeated letter different chips at different positions', () => {
    // Otherwise every "s" in a heading would be cut from the same magazine, and the row would
    // visibly stripe instead of reading as hand-pasted.
    const chips = toRansom('sssssssss');
    const variants = new Set(chips.map((c) => c.variant));

    expect(variants.size).toBeGreaterThan(1);
  });

  it('deals every look exactly once per run of four letters', () => {
    // The property the deck buys us. Hashing letters independently had no such guarantee: it dealt
    // "Your Playlists" six blue chips and zero red, silently dropping a colour from the palette.
    const letters = toRansom('Your Playlists Are Here Now').filter((c) => !c.isSpace);

    for (let i = 0; i + RANSOM_VARIANTS <= letters.length; i += RANSOM_VARIANTS) {
      const run = letters.slice(i, i + RANSOM_VARIANTS).map((c) => c.variant);
      expect(new Set(run).size).toBe(RANSOM_VARIANTS);
    }
  });

  it('uses every look the stylesheet defines on a real heading', () => {
    const variants = new Set(toRansom('Your Playlists').map((c) => c.variant));

    expect(variants.size).toBe(RANSOM_VARIANTS);
  });

  it('does not let a word gap shift the deal', () => {
    // Spaces must not consume a card, or a heading's runs would straddle the deck boundary and the
    // once-per-run guarantee would quietly stop holding.
    const spaced = toRansom('ab cd').filter((c) => !c.isSpace);
    const tight = toRansom('ab cd'.replace(' ', ''));

    expect(spaced.map((c) => c.variant)).not.toContain(undefined);
    expect(new Set(spaced.map((c) => c.variant)).size).toBe(RANSOM_VARIANTS);
    expect(tight).toHaveLength(4);
  });

  it('handles an empty string without inventing a chip', () => {
    expect(toRansom('')).toEqual([]);
  });

  it('keeps multi-byte characters whole', () => {
    // Array.from iterates code points; a naive split('') would cut an emoji in half and emit two
    // broken chips.
    const chips = toRansom('a★b');

    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.char)).toEqual(['a', '★', 'b']);
  });
});
