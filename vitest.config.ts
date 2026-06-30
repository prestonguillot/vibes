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
    exclude: [...configDefaults.exclude, 'tests/live/**', 'tests/visual/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.config.ts',
        '**/*.d.ts',
        'public/**',
        'views/**',
        '.claude/**'
      ]
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests')
    }
  }
});
