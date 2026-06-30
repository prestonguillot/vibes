import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Config for the opt-in live API harness (`npm run test:spotify:live`). Runs ONLY
 * tests/live, loads real credentials from .env (not .env.test), and allows a long
 * timeout for real network round-trips. Not part of the normal test cycle.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    setupFiles: ['./tests/live/setup.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
});
