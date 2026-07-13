import { defineConfig } from '@playwright/test';

/**
 * Argos visual-testing config. The point: NO committed PNG baselines. Argos stores baselines
 * server-side keyed by commit/branch, diffs them, auto-passes builds with no change, and asks
 * for an accept/reject decision only when pixels actually move - surfaced as the required
 * `argos/default` GitHub check via the Argos GitHub App. So there is no snapshotPathTemplate
 * and nothing binary lands in git.
 *
 * Run: `npm run test:visual:argos`. Upload only happens when ARGOS_TOKEN is set (CI with the
 * secret configured); locally without a token it just captures + validates the screenshots
 * render, staying green. `ignoreUploadFailures` keeps the job green if Argos is unreachable.
 *
 * Every spec runs under each project below, so each capture is baselined per viewport. Both use
 * Chromium; a real iOS-Safari (WebKit) project is a follow-up once the mobile layout is worked.
 */
export default defineConfig({
  testDir: './tests/visual-argos',
  fullyParallel: true,
  // Every spec runs under each project, so each view is baselined per viewport AND per theme.
  // The theme is applied via metadata.theme (specs set [data-theme] from it in beforeEach).
  projects: [
    {
      name: 'desktop',
      metadata: { theme: 'light' },
      use: { viewport: { width: 1000, height: 900 } },
    },
    {
      name: 'desktop-dark',
      metadata: { theme: 'dark' },
      use: { viewport: { width: 1000, height: 900 } },
    },
    // Mobile: iPhone Air as Chrome DevTools emulates it (420x921 logical). deviceScaleFactor is
    // left at 1 - layout regression doesn't need 3x rendering, and it keeps the baselines cheap.
    {
      name: 'mobile',
      metadata: { theme: 'light' },
      use: { viewport: { width: 420, height: 921 } },
    },
    {
      name: 'mobile-dark',
      metadata: { theme: 'dark' },
      use: { viewport: { width: 420, height: 921 } },
    },
  ],
  reporter: [
    ['list'],
    [
      '@argos-ci/playwright/reporter',
      {
        uploadToArgos: !!process.env.ARGOS_TOKEN,
        ignoreUploadFailures: true,
      },
    ],
  ],
});
