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
      // while a mutation run is in flight also globs the sandbox copies - running duplicate tests
      // against deliberately broken source, and failing for no real reason.
      '.stryker-tmp/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Without `include`, vitest reports ONLY files a test imported: an untested module is absent
      // from the report rather than reported as uncovered, and the total is an average over
      // whatever happened to be imported. public/js is application code and belongs here too -
      // its tests import the modules rather than eval them, because v8 cannot attribute coverage
      // to eval'd code.
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
