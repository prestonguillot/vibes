/**
 * Styling tests for ransom-note lettering.
 * Guards the things that made the chips read as tiles rather than clippings.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RANSOM_VARIANTS } from '@/lib/ransom';

const cssContent = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf-8');

const variantBlock = (v: number) =>
  cssContent.match(new RegExp(`\\.ransom__chip--v${v}\\s*{[\\s\\S]*?\\n}`))?.[0] ?? '';

describe('Ransom chip styling', () => {
  it('defines a look for every variant the helper can deal', () => {
    for (let v = 0; v < RANSOM_VARIANTS; v++) {
      expect(variantBlock(v), `.ransom__chip--v${v} is missing`).toBeTruthy();
    }
  });

  it('cuts every chip to an irregular outline', () => {
    // Perfect rectangles were the first reason these read as tiles: nothing gets cut out of a
    // magazine with a paper trimmer.
    for (let v = 0; v < RANSOM_VARIANTS; v++) {
      expect(variantBlock(v)).toMatch(/--cut:\s*polygon\(/);
    }
  });

  it('gives every chip a crease', () => {
    // Flatness was the third reason. A scrap that has never been folded is a tile.
    for (let v = 0; v < RANSOM_VARIANTS; v++) {
      expect(variantBlock(v)).toMatch(/--crease:\s*linear-gradient\(/);
    }
  });

  it('cuts no two chips to the same outline', () => {
    const cuts = Array.from(
      { length: RANSOM_VARIANTS },
      (_, v) => variantBlock(v).match(/--cut:\s*polygon\([\s\S]*?\)/)?.[0],
    );

    expect(new Set(cuts).size).toBe(RANSOM_VARIANTS);
  });

  it('prints the letter with the same toner as the rest of the page', () => {
    // Laser-crisp type was the second reason. The overlay has to sit over the ink, not just the
    // paper - a clipping's letters are photocopied too.
    const after = cssContent.match(/\.ransom__chip::after\s*{[^}]*}/)?.[0] ?? '';

    expect(after).toContain("url('/images/toner.svg')");
    expect(after).toContain('mix-blend-mode: multiply');
  });

  it('contains the overlays so they cannot blend through to the header', () => {
    // Without isolation the multiply reaches the #000 header behind and the scrap goes black.
    const chip = cssContent.match(/\.ransom__chip\s*{[^}]*}/)?.[0] ?? '';

    expect(chip).toContain('isolation: isolate');
  });

  it('keeps the chips out of red-white-and-blue', () => {
    // Red + white + blue across a row of chips reads as a flag whatever the intent. The palette is
    // Bollocks - red and acid yellow on newsprint - which is what the masthead already speaks.
    const blocks = Array.from({ length: RANSOM_VARIANTS }, (_, v) => variantBlock(v)).join('\n');

    expect(blocks).not.toContain('#0066ff');
  });
});
