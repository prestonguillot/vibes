import { defineConfig } from '@playwright/test';

/**
 * Behavioural browser tests for the native-<dialog> modals, alert dismissal, and the sync-status
 * SSE wiring - DOM/JS assertions with the real partials + JS, no screenshots. All pixel baselines
 * now live in Argos (see playwright.argos.config.ts + tests/visual-argos).
 *
 * Run on-demand: `npm run test:visual`. Local-only - not part of the vitest cycle.
 */
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  use: {
    viewport: { width: 1000, height: 900 },
  },
});
