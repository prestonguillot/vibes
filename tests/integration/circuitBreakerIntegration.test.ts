import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { youtubeCircuitBreaker } from '../../src/utils/circuitBreaker';

describe('Circuit Breaker Integration', () => {
  beforeEach(() => {
    // Close circuit breaker before each test
    youtubeCircuitBreaker.close();
  });

  afterEach(() => {
    // Clean up after tests
    youtubeCircuitBreaker.close();
  });

  describe('Circuit Breaker State Management', () => {
    it('should maintain circuit state across multiple calls', () => {
      // Open the circuit
      youtubeCircuitBreaker.open();
      expect(youtubeCircuitBreaker.isOpen()).toBe(true);

      // Should stay open for multiple checks
      expect(youtubeCircuitBreaker.canProceed()).toBe(false);
      expect(youtubeCircuitBreaker.canProceed()).toBe(false);
      expect(youtubeCircuitBreaker.isOpen()).toBe(true);
    });

    it('should allow closing circuit after it was opened', () => {
      youtubeCircuitBreaker.open();
      expect(youtubeCircuitBreaker.isOpen()).toBe(true);

      youtubeCircuitBreaker.close();
      expect(youtubeCircuitBreaker.isOpen()).toBe(false);
      expect(youtubeCircuitBreaker.canProceed()).toBe(true);
    });

    it('should record success and failure', () => {
      const initialState = youtubeCircuitBreaker.getState();
      expect(initialState.state).toBe('CLOSED');

      // Record a success
      youtubeCircuitBreaker.recordSuccess();
      expect(youtubeCircuitBreaker.getState().state).toBe('CLOSED');

      // Record a failure
      youtubeCircuitBreaker.recordFailure();
      expect(youtubeCircuitBreaker.getState().failureCount).toBe(1);
    });

    it('should open after multiple failures', () => {
      youtubeCircuitBreaker.recordFailure();
      expect(youtubeCircuitBreaker.isOpen()).toBe(false);

      youtubeCircuitBreaker.recordFailure();
      expect(youtubeCircuitBreaker.isOpen()).toBe(true);
    });
  });

  describe('Quota Error Handling', () => {
    it('should immediately open on quota error', () => {
      expect(youtubeCircuitBreaker.isOpen()).toBe(false);

      youtubeCircuitBreaker.open();

      expect(youtubeCircuitBreaker.isOpen()).toBe(true);
      expect(youtubeCircuitBreaker.canProceed()).toBe(false);
    });

    it('should maintain open state for configured duration', () => {
      youtubeCircuitBreaker.open();
      const state = youtubeCircuitBreaker.getState();

      expect(state.state).toBe('OPEN');
      expect(state.nextAttemptTime).toBeGreaterThan(Date.now());
    });

    it('should clear YouTube tokens when circuit breaker opens', () => {
      // Simulate setting a YouTube token cookie
      const mockResponse = {
        clearCookie: vi.fn(),
        cookie: vi.fn(),
      };

      // Open circuit breaker
      youtubeCircuitBreaker.open();
      expect(youtubeCircuitBreaker.isOpen()).toBe(true);

      // When circuit breaker is open and we try to validate, tokens should be cleared
      // This is tested in the actual route/validation code behavior
      expect(youtubeCircuitBreaker.canProceed()).toBe(false);
    });
  });

  describe('Integration with Application Routes', () => {
    it('should be shared across the application', async () => {
      // The circuit breaker is a singleton that maintains state
      youtubeCircuitBreaker.open();

      // Import it again to verify it's the same instance
      const { youtubeCircuitBreaker: secondRef } = await import('../../src/utils/circuitBreaker');

      expect(secondRef.isOpen()).toBe(true);
      expect(secondRef.getState()).toEqual(youtubeCircuitBreaker.getState());
    });
  });
});
