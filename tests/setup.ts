/**
 * Global test setup. Runs before all test files.
 *
 * The app logger is silenced for tests via `LOG_LEVEL=silent` (vitest.config.ts `test.env`), so its
 * output - including the deliberate error-path logging many tests exercise - never interleaves with
 * the test runner's output. Note logger.ts reads that level at MODULE SCOPE, so a test that needs
 * the logger to actually emit has to set the level itself rather than rely on the env.
 *
 * No .env file is loaded. This used to call dotenv.config({ path: '.env.test' }) for a file that
 * does not exist in the repo, so it did nothing. Tests that need credentials set process.env
 * themselves (see tests/unit/spotifyClient.test.ts), which keeps each test's requirements visible
 * in the test instead of in ambient state - and leaves src/lib/envValidation.ts testable against a
 * genuinely empty environment.
 */

process.env.NODE_ENV = 'test';
