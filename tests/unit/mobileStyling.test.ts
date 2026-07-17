/**
 * Styling tests for the phone layout.
 *
 * Every check here is a bug Preston found by looking at a real phone, and each one is the kind CSS
 * fails at silently: nothing throws, the page renders, it is just wrong.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf-8');

/** The phone block. Rules outside it are desktop and must not be matched by accident. */
const mobile = css.match(/@media \(max-width: 575\.98px\) \{[\s\S]*?\n\}\n/)?.[0] ?? '';

/**
 * Anchored to the start of a line, because these selectors also appear as the TAIL of longer ones
 * (`.track-item--art-fill .track-content`), and an unanchored match returns that rule instead.
 */
const ruleIn = (block: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`^\\s*${escaped}\\s*\\{[^}]*\\}`, 'm'))?.[0] ?? '';
};

/** Every rule for a selector, so a duplicate declaration can't hide behind the cascade. */
const rulesFor = (block: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`^\\s*${escaped}\\s*\\{[^}]*\\}`, 'gm')) ?? [];
};

describe('Phone layout', () => {
  it('finds the mobile block at all', () => {
    expect(mobile).toBeTruthy();
  });

  it('never places a track-row child past the columns the grid declares', () => {
    // The original bug: the row declared `1fr` and the status bar asked for column 2, so grid
    // invented an implicit one and split a 420px row into 145px + 118px - badges in a diagonal
    // corner, video title wrapping after three words. The row is two columns ON PURPOSE now, which
    // is fine; asking for a column that was never declared is what is not.
    const tracks = ruleIn(mobile, '.track-item').match(/grid-template-columns:\s*([^;]+);/)?.[1];
    expect(tracks, '.track-item declares no columns on mobile').toBeTruthy();
    const declared = (tracks ?? '').trim().split(/\s+/).length;

    const used = [...mobile.matchAll(/grid-column:\s*(\d+)\s*;/g)].map((m) => Number(m[1]));
    expect(used.length).toBeGreaterThan(0);
    used.forEach((col) =>
      expect(col, `column ${col} used but only ${declared} declared`).toBeLessThanOrEqual(declared),
    );
  });

  it('declares the row and its content once each, not twice', () => {
    // Two rules for one selector is how `filter: var(--bleed-print)` sat in the stylesheet doing
    // nothing for a release: the later declaration wins and the earlier one reads as intent.
    expect(rulesFor(mobile, '.track-item')).toHaveLength(1);
    expect(rulesFor(mobile, '.track-content')).toHaveLength(1);
  });

  it('promotes the row’s content so the stamps can sit beside the preview', () => {
    // The preview is nested inside .track-content and the stamps are its sibling, so they cannot
    // share a row without display:contents lifting .track-content's children into the grid.
    expect(ruleIn(mobile, '.track-content')).toContain('display: contents');
  });

  it('lifts the picture above the bleed, not the boxless wrapper', () => {
    // The bleed painted over the preview while `.youtube-video` carried position:relative AND
    // z-index:1 - but it is display:contents, so it has no box and both were ignored. The thing
    // lifted must be one that actually generates a box: the <img> itself.
    expect(mobile).toMatch(
      /img\.youtube-video__thumbnail[\s\S]{0,220}position: relative;\s*z-index: 1/,
    );
    // ...and the wrapper really is contents, so this is not a theoretical worry.
    expect(mobile).toMatch(/\.youtube-video[\s\S]{0,700}display: contents/);
  });

  it('spreads the rail evenly - LINKED, edit and stars in one flex column', () => {
    // The three controls are one group in the markup now (all inside .track-status), so the rail
    // is a plain flex column that distributes them down the preview's height.
    const rail = ruleIn(mobile, '.track-status:has(.badge)');

    expect(rail).toContain('flex-direction: column');
    expect(rail).toContain('justify-content: space-evenly');
    expect(rail).toContain('align-self: stretch');
  });

  it('lets the bleed cover a stacked row instead of floating in it', () => {
    // A fixed 220px square in a 279px stacked row reads as a block sitting inside the row rather
    // than ink running off the sheet.
    const bleed = ruleIn(mobile, '.track-bleed::after');

    expect(bleed).toMatch(/height:\s*\d+%/);
    expect(bleed).not.toMatch(/height:\s*\d+px/);
  });

  it('never lets the cut-out heading break', () => {
    // The letters are physical scraps; a word cannot come apart mid-air. nowrap makes that
    // structural, flex-shrink:0 stops the bar squeezing the box while the chips spill out of it.
    const ransom = ruleIn(mobile, '.ransom');

    expect(ransom).toContain('flex-wrap: nowrap');
    expect(ransom).toContain('flex-shrink: 0');
  });

  it('scales the heading fluidly, and trims the scrap not just the type', () => {
    // Each chip's padding is fixed px: 13 of them contribute ~156px that no font-size can touch,
    // so the heading bottomed out at 235px however small the letters got.
    expect(ruleIn(mobile, '.playlists-panel .card-header h5')).toContain('clamp(');
    expect(ruleIn(mobile, '.playlists-panel .ransom__chip')).toMatch(/padding:\s*1px 2px/);
  });

  it('gives the theme mark a finger-sized target where there is no hover', () => {
    // 0.45 opacity works when a pointer can hover it up to full. There is no hover on a phone, so
    // quiet-until-you-look becomes gone - and 26px is under the ~44px minimum for a finger.
    const touch = css.match(/@media \(hover: none\) \{[\s\S]*?\n\}\n/)?.[0] ?? '';

    expect(touch).toBeTruthy();
    const toggle = ruleIn(touch, '.theme-toggle');
    expect(toggle).toMatch(/width:\s*44px/);
    expect(Number(toggle.match(/opacity:\s*([\d.]+)/)?.[1])).toBeGreaterThan(0.7);
  });
});
