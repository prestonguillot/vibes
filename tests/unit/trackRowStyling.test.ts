/**
 * Styling tests for track rows.
 *
 * Rows are told apart by a misregistered halftone: the screen prints black, the red plate lands a
 * couple of px off, and the rule between rows slips the same way. Both traps guarded below fail
 * SILENTLY - the page still renders, just wrong - so they're pinned here rather than trusted.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const cssContent = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf-8');

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cssContent.match(new RegExp(`${escaped}\\s*{[^}]*}`))?.[0] ?? '';
};

describe('Track row styling', () => {
  it('prints the row screen as a halftone, not a barber-pole hatch', () => {
    const even = rule('.track-item--even');

    expect(even).toContain('radial-gradient');
    expect(even).toContain('var(--row-plate)');
    expect(even).toContain('var(--row-screen)');
    expect(even).not.toContain('repeating-linear-gradient');
  });

  it('offsets the plate from the screen, or there is no misregistration to see', () => {
    const even = rule('.track-item--even');
    const positions = even.match(/background-position:\s*([^;]+);/)?.[1] ?? '';

    // Two positions, and they must differ - identical ones would print the inks on top of each
    // other and the doubling would vanish.
    const parts = positions.split(',').map((p) => p.trim());
    expect(parts).toHaveLength(2);
    expect(parts[0]).not.toBe(parts[1]);
  });

  it('prints both inks at comparable weight in both themes', () => {
    // The first build had the plate at 0.5 against a 0.08 screen: the red swamped the black and the
    // row read as coloured dots with no doubling at all. Neither ink may shout down the other.
    const alphas = [
      ...cssContent.matchAll(/--row-(?:screen|plate):\s*rgba\([^)]*?,\s*([\d.]+)\)/g),
    ].map((m) => Number(m[1]));

    expect(alphas).toHaveLength(4); // screen + plate, light + dark
    alphas.forEach((a) => expect(a).toBeLessThan(0.35));
    expect(Math.max(...alphas) / Math.min(...alphas)).toBeLessThan(3);
  });

  it('hangs the slipped plate off ::before, leaving ::after to the album-art bleed', () => {
    // `.track-item + .track-item::after` (0,2,1) outranks `.track-item--art-fill::after` (0,1,1),
    // so using ::after here would erase the bleed on every row but the first.
    expect(rule('.track-item + .track-item::before')).toBeTruthy();
    expect(cssContent).not.toMatch(/\.track-item \+ \.track-item::after/);
    expect(rule('.track-item--art-fill::after')).toContain('var(--album-art)');
  });

  it('keeps the plate inside the row, which art rows clip to', () => {
    // .track-item--art-fill is overflow:hidden; a ghost positioned above the row's edge would be
    // clipped away on exactly the rows that have artwork.
    const ghost = rule('.track-item + .track-item::before');
    // Unitless `0` is valid and is what's there - don't require a px suffix.
    const top = ghost.match(/top:\s*(-?[\d.]+)(?:px)?\s*;/)?.[1];

    expect(Number(top)).toBeGreaterThanOrEqual(0);
    expect(rule('.track-item--art-fill')).toContain('overflow: hidden');
  });

  it('anchors the plate to the row', () => {
    // Without a positioned row the absolute ghost escapes to the nearest positioned ancestor.
    expect(rule('.track-item')).toContain('position: relative');
  });

  it('leaves no trace of the barber stripes it replaced', () => {
    expect(cssContent).not.toContain('--row-stripe');
  });
});
