import { defineConfig } from '@playwright/test';

/**
 * Visual-regression config. Renders the real EJS partials with fixtures + the
 * actual stylesheets and screenshots them, diffing against committed baselines.
 *
 * Run on-demand: `npm run test:visual` (and `npm run test:visual:update` to
 * refresh baselines after an intentional visual change). NOT part of the normal
 * cycle / CI - screenshot pixels differ across OS (font anti-aliasing), so
 * baselines are environment-specific and meant for local pre/post-refactor checks.
 */
export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  use: {
    viewport: { width: 1000, height: 900 },
  },
  expect: {
    // Allow a tiny tolerance for sub-pixel AA noise; real layout/colour changes far exceed this.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
});
