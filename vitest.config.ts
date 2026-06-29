import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // tests/live hits the real Spotify API; it is opt-in via `npm run test:spotify:live`
    // (vitest.live.config.ts) and must never run on the normal cycle.
    exclude: [...configDefaults.exclude, 'tests/live/**'],
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
