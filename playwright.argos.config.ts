import { defineConfig } from '@playwright/test';

/**
 * Argos visual-testing prototype config (separate from playwright.config.ts so the existing
 * local snapshot suite is untouched). The key difference: NO committed PNG baselines. Argos
 * stores baselines server-side keyed by commit/branch, diffs them, and exposes an
 * accept/reject UI + a required GitHub check via the Argos GitHub App. So there is no
 * snapshotPathTemplate and nothing binary lands in git.
 *
 * Run: `npm run test:visual:argos`. Upload only happens when ARGOS_TOKEN is set (CI with the
 * secret configured); locally without a token it just captures + validates the screenshots
 * render, staying green. `ignoreUploadFailures` keeps the job green if Argos is unreachable.
 */
export default defineConfig({
  testDir: './tests/visual-argos',
  fullyParallel: true,
  use: {
    viewport: { width: 1000, height: 900 },
  },
  reporter: [
    ['list'],
    [
      '@argos-ci/playwright/reporter',
      {
        uploadToArgos: !!process.env.ARGOS_TOKEN,
        ignoreUploadFailures: true,
        buildName: 'prototype',
      },
    ],
  ],
});
