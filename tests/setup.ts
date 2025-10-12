/**
 * Global test setup
 * Runs before all tests
 */

import { beforeAll, afterAll, afterEach } from 'vitest';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Global test setup
beforeAll(() => {
  // Setup that runs once before all tests
  console.log('🧪 Test suite starting...');
});

// Global test teardown
afterAll(() => {
  // Cleanup that runs once after all tests
  console.log('✅ Test suite completed');
});

// Cleanup after each test
afterEach(() => {
  // Reset any test-specific state
});
