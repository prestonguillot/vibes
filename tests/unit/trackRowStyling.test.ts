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

  it('carries the album-art bleed on its own clipping layer, not the row', () => {
    // The bleed used to be .track-item--art-fill::after, and the row clipped it with
    // overflow:hidden - which also clipped the score tooltip. It now lives on .track-bleed so the
    // row can be overflow:visible and the tooltip can escape.
    expect(rule('.track-bleed::after')).toContain('var(--album-art)');
    expect(rule('.track-bleed')).toContain('overflow: hidden');
    expect(rule('.track-item--art-fill')).not.toContain('overflow: hidden');
  });

  it('keeps the slipped plate at the top edge, inside the row', () => {
    // On ::before, sitting at the row's top edge - so it needs no overflow to contain it, which is
    // just as well now that the row no longer clips.
    const ghost = rule('.track-item + .track-item::before');
    // Unitless `0` is valid and is what's there - don't require a px suffix.
    const top = ghost.match(/top:\s*(-?[\d.]+)(?:px)?\s*;/)?.[1];

    expect(Number(top)).toBeGreaterThanOrEqual(0);
    expect(cssContent).not.toMatch(/\.track-item \+ \.track-item::after/);
  });

  it('lifts the hovered row so the escaped score tooltip clears its neighbours', () => {
    // Un-clipping the row lets the tooltip out; it still has to paint ABOVE the next row and the
    // stamp beside it, which are later in the DOM. The row and its content rise on hover.
    expect(cssContent).toMatch(
      /\.track-item:has\(\.match-score-badge:hover\)[\s\S]{0,80}z-index:\s*40/,
    );
    expect(cssContent).toMatch(/\.match-score-badge:hover\s*\{[^}]*z-index:\s*4[01]/);
  });

  it('anchors the plate to the row', () => {
    // Without a positioned row the absolute ghost escapes to the nearest positioned ancestor.
    expect(rule('.track-item')).toContain('position: relative');
  });

  it('leaves no trace of the barber stripes it replaced', () => {
    expect(cssContent).not.toContain('--row-stripe');
  });
});

describe('Desktop rail', () => {
  it('stacks the stars under the stamps, not beside them', () => {
    // Stars BESIDE LINKED+edit widened the status column and starved the middle title/video column.
    // .track-status is a flex column (stamps row on top, stars beneath), and .track-stamps groups
    // LINKED+edit so the column measures to their width, not the wider unwrapped three-across.
    expect(rule('.track-status')).toContain('flex-direction: column');
    expect(rule('.track-stamps')).toContain('display: flex');
  });

  it('dissolves the stamp group on mobile so all three space out evenly', () => {
    // On the phone the rail wants LINKED, edit and stars as three evenly-spaced items, so the
    // desktop grouping must become display:contents there.
    const mobile = cssContent.match(/@media \(max-width: 575\.98px\) \{[\s\S]*?\n\}\n/)?.[0] ?? '';
    expect(mobile).toMatch(/\.track-stamps\s*\{[^}]*display:\s*contents/);
  });
});
