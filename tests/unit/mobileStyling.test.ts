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

const ruleIn = (block: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
};

describe('Phone layout', () => {
  it('finds the mobile block at all', () => {
    expect(mobile).toBeTruthy();
  });

  it('keeps the track row to the one column it declares', () => {
    // `.track-item` is grid-template-columns: 1fr here. Placing the status bar at column 2 made
    // grid invent an implicit second column and split a 420px row into 145px + 118px - which put
    // the badges in a diagonal corner and wrapped the video title after three words.
    expect(ruleIn(mobile, '.track-item')).toContain('grid-template-columns: 1fr');
    expect(ruleIn(mobile, '.track-status:has(.badge)')).toContain('grid-column: 1');
    expect(ruleIn(mobile, '.track-status:has(.badge)')).not.toContain('grid-column: 2');
  });

  it('lets the bleed cover a stacked row instead of floating in it', () => {
    // A fixed 220px square in a 279px stacked row reads as a block sitting inside the row rather
    // than ink running off the sheet.
    const bleed = ruleIn(mobile, '.track-item--art-fill::after');

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
