/**
 * Circuit Breaker Configuration
 *
 * Defines configuration for circuit breakers that protect against external API failures.
 * Each API client should have its own circuit breaker with independent configuration.
 */

export interface CircuitBreakerConfig {
  failureThreshold: number;  // Number of failures before opening circuit
  resetTimeout: number;      // Time in ms before attempting to close circuit
  successThreshold: number;  // Number of successes in HALF_OPEN before closing
}

/**
 * Configuration for YouTube API circuit breaker
 *
 * YouTube has strict quota limits (typically 10,000 units per day).
 * Quota errors (403) are rate-limit errors that need a longer timeout.
 */
export const youtubeCircuitBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 2,           // Open after 2 quota failures
  resetTimeout: 15 * 60 * 1000,  // Quota resets daily, so probe at most every 15 min (not every 10s)
  successThreshold: 1            // Close after 1 successful request
};

/**
 * Configuration for Spotify API circuit breaker
 *
 * Spotify has more generous rate limits than YouTube (typically 429 on rate limit).
 * Can be configured independently if Spotify limits prove different from YouTube.
 */
export const spotifyCircuitBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 2,        // Open after 2 quota failures
  resetTimeout: 10 * 1000,    // Wait 10 seconds before retrying
  successThreshold: 1          // Close after 1 successful request
};
