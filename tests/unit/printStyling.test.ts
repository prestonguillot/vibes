/**
 * Styling tests for the press: every picture in the app is run through a filter, because a
 * full-colour photograph is otherwise the only object on a photocopied page that never went near
 * one.
 *
 * These guard the decisions that are invisible when they break - a filter that silently no-ops
 * still renders a perfectly good page, just the wrong one.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf-8');
const filters = fs.readFileSync(path.join(root, 'views/partials/print-filters.ejs'), 'utf-8');

// Anchored to the start of a line: several of these selectors also appear as the TAIL of a longer
// one (`.tracks-list .track-item:nth-child(4n+3) .youtube-video__thumbnail`), and an unanchored
// match happily returns that rule instead.
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`^${escaped}\\s*{[^}]*}`, 'm'))?.[0] ?? '';
};

describe('The press', () => {
  it('gives every feColorMatrix exactly 20 values', () => {
    // 4 rows x 5. One extra and the matrix is invalid, the browser drops it silently, and every
    // filter downstream screens a colour image while reporting no error at all.
    const matrices = [...filters.matchAll(/type="matrix"\s+values="([^"]+)"/g)];

    expect(matrices.length).toBeGreaterThan(0);
    matrices.forEach((match) => {
      expect(match[1]?.trim().split(/\s+/)).toHaveLength(20);
    });
  });

  it('forces alpha back to opaque wherever it composites arithmetically', () => {
    // feComposite's arithmetic runs on alpha too: k2*1 + k3*1 + k4 = 1 - 1 + 0.5 leaves every pixel
    // half-transparent and the page shows straight through the picture.
    const halftone = filters.match(/<filter\s+id="print-photo"[\s\S]*?<\/filter>/)?.[0] ?? '';

    expect(halftone).toContain('operator="arithmetic"');
    // The screen and grain passes both multiply (k1=1), which leaves alpha at 1*1 = 1.
    const arithmetic = [...halftone.matchAll(/operator="arithmetic"[^/]*?k1="([\d.]+)"/g)];
    expect(arithmetic.length).toBeGreaterThan(0);
    arithmetic.forEach(([, k1]) => expect(Number(k1)).toBe(1));
  });

  it('prints the thumbnails and the covers', () => {
    expect(rule('img.youtube-video__thumbnail')).toContain("filter: url('#print-photo')");
    expect(rule('.playlist-cover')).toContain("filter: url('#print-photo')");
  });

  it('spares the placeholder, which is a div holding a question mark', () => {
    // The class is shared with --placeholder. Unscoped, the press halftones and plate-shifts a
    // piece of UI that is not a photograph and never went near a press.
    expect(rule('.youtube-video__thumbnail')).not.toContain('#print-photo');
    expect(rule('.youtube-video__thumbnail--placeholder')).not.toContain('#print-photo');
    expect(css).toMatch(/^img\.youtube-video__thumbnail\s*{/m);
  });

  it('peels the print back to the photograph on hover, not the other way round', () => {
    // This shipped inverted: the cover was a colour photo that got photocopied on hover. On a
    // photocopied zine the print is what exists and the colour original is what you go looking for.
    expect(rule('.playlist-item:hover .playlist-cover')).toContain('filter: none');
  });

  it('prints the bleeds 1-bit, and inverts them on dark paper', () => {
    // Without the invert the picture's dark areas sink into the near-black card and only its
    // highlights survive - you see the bleed's negative space instead of the bleed.
    expect(css).toMatch(/--bleed-print:\s*url\('#print-bleed'\);/);
    expect(css).toMatch(/--bleed-print:\s*url\('#print-bleed'\) invert\(1\);/);
    expect(rule('.track-item--art-fill::after')).toContain('filter: var(--bleed-print)');
    expect(rule('.playlist-item--art::after')).toContain('filter: var(--bleed-print)');
  });

  it('declares filter exactly once in each rule that prints', () => {
    // The test above passed for a full release while the playlist cover was NOT printed: the rule
    // carried `filter: var(--bleed-print)` AND, six lines later, `filter: contrast(1.1)
    // saturate(1.2)`. The later declaration won and the string sat in the file doing nothing.
    // "The stylesheet contains X" and "X takes effect" are different claims, and only this one
    // catches the difference.
    [
      '.track-item--art-fill::after',
      '.playlist-item--art::after',
      'img.youtube-video__thumbnail',
    ].forEach((selector) => {
      const declarations = rule(selector).match(/^\s*filter:/gm) ?? [];
      expect(declarations, `${selector} declares filter ${declarations.length} times`).toHaveLength(
        1,
      );
    });
  });

  it('leaves no trace of the overprinted artist', () => {
    expect(css).not.toContain('track-art-word');
  });
});

describe('The margin marks', () => {
  it('draws the theme toggle as a patch, not a bordered button', () => {
    const toggle = rule('.theme-toggle');

    expect(toggle).toContain('border: 0');
    expect(toggle).not.toContain('box-shadow: 3px 3px');
    expect(rule('.theme-toggle__icon')).toContain('border-radius: 50%');
  });

  it('makes the inked half the state, and flips it on dark', () => {
    expect(rule('.theme-toggle__icon')).toContain('linear-gradient');
    expect(rule("[data-theme='dark'] .theme-toggle__icon")).toContain('linear-gradient');
  });

  it('hand-cuts the search icon instead of borrowing a font’s emoji', () => {
    const icon = rule('.search-icon');

    expect(icon).toMatch(/mask:\s*url\('\/images\/magnifier\.svg'\)/);
    expect(icon).toContain('background-color: var(--text-muted)');
    expect(fs.existsSync(path.join(root, 'public/images/magnifier.svg'))).toBe(true);
  });
});
