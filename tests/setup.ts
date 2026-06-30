/**
 * Global test setup. Runs before all test files.
 *
 * The app logger is silenced for tests via `LOG_LEVEL=silent` (vitest.config.ts
 * `test.env`), so its output - including the deliberate error-path logging many
 * tests exercise - never interleaves with the test runner's output.
 */

import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';
