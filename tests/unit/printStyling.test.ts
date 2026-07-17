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

  it('prints the artist behind the row, not over its controls', () => {
    // A linked row carries a video link and a status badge on the same side the word sits on.
    // As a foreground element it draws straight over both.
    const word = rule('.track-art-word');

    expect(word).toMatch(/z-index:\s*0/);
    expect(rule('.track-item--art-fill > *')).toMatch(/z-index:\s*1/);
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

  it('overprints the artist in a third ink', () => {
    // The bleed is 1-bit, so white is already one of its two values: a knocked-out white word
    // dissolves into the picture's own highlights. Red is in neither.
    const word = rule('.track-art-word');

    expect(word).toContain('#ff0040');
    expect(word).not.toMatch(/color:\s*var\(--surface\)/);
  });

  it('flips the artist’s offset plate on dark, where a black one would not exist', () => {
    expect(rule('.track-art-word')).toMatch(/text-shadow:[^;]*rgba\(var\(--shadow-rgb\)/);
  });

  it('anchors the artist from the left so a long name bleeds off rather than being cut', () => {
    // Anchored right, "Operation Ivy" gets guillotined at the row edge - which reads as a bug.
    // "Fugazi" fits and hides the problem.
    const word = rule('.track-art-word');

    expect(word).toMatch(/left:\s*\d+%/);
    expect(word).not.toMatch(/\bright:\s/);
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
