import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/lib/circuitBreaker';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('Test Circuit', {
      failureThreshold: 2,
      resetTimeout: 1000, // 1 second for faster tests
      successThreshold: 2,
    });
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      const state = circuitBreaker.getState();
      expect(state.state).toBe(CircuitState.CLOSED);
      expect(state.failureCount).toBe(0);
    });

    it('should allow requests when CLOSED', () => {
      expect(circuitBreaker.canProceed()).toBe(true);
    });

    it('should not be open initially', () => {
      expect(circuitBreaker.isOpen()).toBe(false);
    });
  });

  describe('Failure Handling', () => {
    it('should remain CLOSED after single failure below threshold', () => {
      circuitBreaker.recordFailure();
      const state = circuitBreaker.getState();
      expect(state.state).toBe(CircuitState.CLOSED);
      expect(state.failureCount).toBe(1);
      expect(circuitBreaker.canProceed()).toBe(true);
    });

    it('should open after reaching failure threshold', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      const state = circuitBreaker.getState();
      expect(state.state).toBe(CircuitState.OPEN);
      expect(circuitBreaker.isOpen()).toBe(true);
      expect(circuitBreaker.canProceed()).toBe(false);
    });

    it('should reset failure count after opening', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      const state = circuitBreaker.getState();
      expect(state.failureCount).toBe(0);
    });
  });

  describe('Success Handling', () => {
    it('should reset failure count on success', () => {
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getState().failureCount).toBe(1);

      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getState().failureCount).toBe(0);
    });

    it('should remain CLOSED after success in CLOSED state', () => {
      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getState().state).toBe(CircuitState.CLOSED);
    });
  });

  describe('OPEN State', () => {
    beforeEach(() => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
    });

    it('should reject requests when OPEN', () => {
      expect(circuitBreaker.canProceed()).toBe(false);
    });

    it('should have a future nextAttemptTime when OPEN', () => {
      const state = circuitBreaker.getState();
      expect(state.nextAttemptTime).toBeGreaterThan(Date.now());
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(circuitBreaker.canProceed()).toBe(true);
      const state = circuitBreaker.getState();
      expect(state.state).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('HALF_OPEN State', () => {
    beforeEach(async () => {
      // Open the circuit
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();

      // Wait for reset timeout to enter HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 1100));
      circuitBreaker.canProceed(); // Trigger transition to HALF_OPEN
    });

    it('should allow requests in HALF_OPEN state', () => {
      expect(circuitBreaker.canProceed()).toBe(true);
    });

    it('should close after sufficient successes', () => {
      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getState().state).toBe(CircuitState.HALF_OPEN);

      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getState().state).toBe(CircuitState.CLOSED);
    });

    it('should reopen immediately on failure', () => {
      circuitBreaker.recordFailure();

      const state = circuitBreaker.getState();
      expect(state.state).toBe(CircuitState.OPEN);
      expect(circuitBreaker.canProceed()).toBe(false);
    });
  });

  describe('Manual Control', () => {
    it('should force open when open() is called', () => {
      expect(circuitBreaker.getState().state).toBe(CircuitState.CLOSED);

      circuitBreaker.open();

      expect(circuitBreaker.getState().state).toBe(CircuitState.OPEN);
      expect(circuitBreaker.isOpen()).toBe(true);
    });

    it('should force close when close() is called', async () => {
      // Open the circuit
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getState().state).toBe(CircuitState.OPEN);

      circuitBreaker.close();

      const state = circuitBreaker.getState();
      expect(state.state).toBe(CircuitState.CLOSED);
      expect(state.failureCount).toBe(0);
      expect(state.nextAttemptTime).toBe(0);
    });
  });

  describe('Quota Error Scenario', () => {
    it('should immediately open on quota error', () => {
      const quotaError = { code: 403, message: 'Quota exceeded' };

      circuitBreaker.open();

      expect(circuitBreaker.isOpen()).toBe(true);
      expect(circuitBreaker.canProceed()).toBe(false);
    });

    it('should prevent further requests until timeout', () => {
      circuitBreaker.open();

      // Multiple calls should all be rejected
      expect(circuitBreaker.canProceed()).toBe(false);
      expect(circuitBreaker.canProceed()).toBe(false);
      expect(circuitBreaker.canProceed()).toBe(false);
    });

    it('should allow retry after timeout period', async () => {
      circuitBreaker.open();
      expect(circuitBreaker.canProceed()).toBe(false);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(circuitBreaker.canProceed()).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should respect custom failure threshold', () => {
      const customBreaker = new CircuitBreaker('Custom', { failureThreshold: 5 });

      // Should stay closed through 4 failures
      for (let i = 0; i < 4; i++) {
        customBreaker.recordFailure();
        expect(customBreaker.getState().state).toBe(CircuitState.CLOSED);
      }

      // Should open on 5th failure
      customBreaker.recordFailure();
      expect(customBreaker.getState().state).toBe(CircuitState.OPEN);
    });

    it('should respect custom success threshold in HALF_OPEN', async () => {
      const customBreaker = new CircuitBreaker('Custom', {
        failureThreshold: 2,
        resetTimeout: 100,
        successThreshold: 3,
      });

      // Open and wait for HALF_OPEN
      customBreaker.open();
      await new Promise((resolve) => setTimeout(resolve, 150));
      customBreaker.canProceed();

      // Should need 3 successes to close
      customBreaker.recordSuccess();
      expect(customBreaker.getState().state).toBe(CircuitState.HALF_OPEN);
      customBreaker.recordSuccess();
      expect(customBreaker.getState().state).toBe(CircuitState.HALF_OPEN);
      customBreaker.recordSuccess();
      expect(customBreaker.getState().state).toBe(CircuitState.CLOSED);
    });
  });
});
