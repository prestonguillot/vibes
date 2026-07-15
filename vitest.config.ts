import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Initialize the app logger silent so its output (including the module-load
    // "logger initialized" line and the deliberate error-path logging in tests)
    // never interleaves with the test runner's output.
    env: { LOG_LEVEL: 'silent' },
    // tests/live hits the real Spotify API; it is opt-in via `npm run test:spotify:live`
    // (vitest.live.config.ts) and must never run on the normal cycle.
    // tests/visual* are Playwright specs (toHaveScreenshot + Argos) - never run by vitest.
    exclude: [
      ...configDefaults.exclude,
      'tests/live/**',
      'tests/visual/**',
      'tests/visual-argos/**',
      // Stryker copies the whole project in here to mutate it. Without this, a test run started
      // while a mutation run is in flight globs the sandbox copies too - reporting ~3x the tests,
      // some of them against deliberately mutated source, and failing for no real reason.
      '.stryker-tmp/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Without `include`, vitest reports ONLY files a test imported - so a module nobody tests is
      // absent from the report rather than sitting at 0%, and the total is an average over the
      // tested subset. That hid src/lib/envValidation.ts (150 lines, no tests) entirely.
      // public/js is application code and is covered the same way, now that its tests import the
      // modules rather than eval them (v8 cannot attribute eval'd code to a file).
      include: ['src/**/*.ts', 'public/js/**/*.js'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.config.ts',
        '**/*.d.ts',
        'public/vendor/**',
        'views/**',
        '.claude/**',
        // Type-only modules: erased at runtime, so there is nothing to execute or report.
        'src/types/**',
      ],
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
});
