import { Logger } from './logger';

/**
 * Circuit Breaker for YouTube API quota management
 *
 * States:
 * - CLOSED: Normal operation, requests go through
 * - OPEN: Too many failures, all requests are rejected immediately
 * - HALF_OPEN: Testing if the API has recovered
 */

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

interface CircuitBreakerConfig {
  failureThreshold: number;  // Number of failures before opening circuit
  resetTimeout: number;      // Time in ms before attempting to close circuit
  successThreshold: number;  // Number of successes in HALF_OPEN before closing
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private nextAttemptTime: number = 0;
  private config: CircuitBreakerConfig;
  private name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = {
      failureThreshold: config.failureThreshold || 3,
      resetTimeout: config.resetTimeout || 60000, // 1 minute default
      successThreshold: config.successThreshold || 2
    };

    Logger.info(`Circuit breaker initialized`, {
      name: this.name,
      config: this.config
    });
  }

  /**
   * Check if a request can proceed
   */
  canProceed(): boolean {
    const now = Date.now();

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        if (now >= this.nextAttemptTime) {
          Logger.info(`Circuit breaker transitioning to HALF_OPEN`, {
            name: this.name,
            previousState: this.state
          });
          this.state = CircuitState.HALF_OPEN;
          this.successCount = 0;
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        Logger.info(`Circuit breaker closing after successful recovery`, {
          name: this.name,
          successCount: this.successCount
        });
        this.close();
      }
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(error?: any): void {
    this.failureCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      Logger.warn(`Circuit breaker opening after failure in HALF_OPEN state`, {
        name: this.name,
        error: error?.message || 'Unknown error'
      });
      this.open();
    } else if (this.state === CircuitState.CLOSED && this.failureCount >= this.config.failureThreshold) {
      Logger.warn(`Circuit breaker opening after ${this.failureCount} failures`, {
        name: this.name,
        threshold: this.config.failureThreshold
      });
      this.open();
    }
  }

  /**
   * Force the circuit open (e.g., quota exceeded)
   */
  open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + this.config.resetTimeout;
    this.failureCount = 0;
    this.successCount = 0;

    const resetDate = new Date(this.nextAttemptTime);
    Logger.warn(`Circuit breaker OPEN`, {
      name: this.name,
      resetTime: resetDate.toISOString(),
      resetInMinutes: Math.round(this.config.resetTimeout / 60000)
    });
  }

  /**
   * Force the circuit closed
   */
  close(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;

    Logger.info(`Circuit breaker CLOSED`, {
      name: this.name
    });
  }

  /**
   * Get current state information
   */
  getState(): { state: CircuitState; nextAttemptTime: number; failureCount: number } {
    return {
      state: this.state,
      nextAttemptTime: this.nextAttemptTime,
      failureCount: this.failureCount
    };
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN && Date.now() < this.nextAttemptTime;
  }
}

// YouTube API circuit breaker - longer reset timeout since quota is time-based
export const youtubeCircuitBreaker = new CircuitBreaker('YouTube API', {
  failureThreshold: 2,      // Open after 2 quota failures
  resetTimeout: 5 * 60000,  // Wait 5 minutes before retrying
  successThreshold: 1       // Close after 1 successful request
});

// Spotify API circuit breaker - same configuration as YouTube
// Can be configured independently if Spotify limits prove different
export const spotifyCircuitBreaker = new CircuitBreaker('Spotify API', {
  failureThreshold: 2,      // Open after 2 quota failures
  resetTimeout: 5 * 60000,  // Wait 5 minutes before retrying
  successThreshold: 1       // Close after 1 successful request
});

// Export class for testing
export { CircuitBreaker, CircuitState };
