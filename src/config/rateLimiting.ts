/**
 * Rate Limiting Configuration
 *
 * Configures rate limiters for different endpoints to prevent bot attacks
 * while allowing reasonable human usage.
 *
 * Environment variables can override defaults:
 * - SYNC_RATE_LIMIT_WINDOW_MS: Time window in milliseconds (default: 1000)
 * - SYNC_RATE_LIMIT_MAX_REQUESTS: Max requests per window (default: 1)
 * - PLAYLISTS_RATE_LIMIT_WINDOW_MS: Time window in milliseconds (default: 1000)
 * - PLAYLISTS_RATE_LIMIT_MAX_REQUESTS: Max requests per window (default: 1)
 * - RATE_LIMITING_ENABLED: Enable/disable rate limiting (default: true, false in test)
 */

import { Logger } from '../utils/logger';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Max requests per window
  message: string; // Error message when limit exceeded
  standardHeaders: boolean;
  legacyHeaders: boolean;
  skipSuccessfulRequests: boolean;
  skip?: () => boolean; // Function to skip rate limiting (e.g., for tests)
}

// Determine if rate limiting should be skipped (tests or explicit disable)
const isTestEnvironment = process.env.NODE_ENV === 'test';
const rateLimitingDisabled = process.env.RATE_LIMITING_ENABLED === 'false';
const shouldSkipRateLimiting = isTestEnvironment || rateLimitingDisabled;

// Sync endpoint configuration
export const syncRateLimitConfig: RateLimitConfig = {
  windowMs: parseInt(process.env.SYNC_RATE_LIMIT_WINDOW_MS || '1000', 10),
  max: parseInt(process.env.SYNC_RATE_LIMIT_MAX_REQUESTS || '1', 10),
  message: 'Too many sync requests, please wait a moment before trying again',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skip: () => shouldSkipRateLimiting
};

// Playlists endpoint configuration
export const playlistsRateLimitConfig: RateLimitConfig = {
  windowMs: parseInt(process.env.PLAYLISTS_RATE_LIMIT_WINDOW_MS || '1000', 10),
  max: parseInt(process.env.PLAYLISTS_RATE_LIMIT_MAX_REQUESTS || '1', 10),
  message: 'Too many playlist requests, please wait a moment',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skip: () => shouldSkipRateLimiting
};

// Log rate limiting configuration at startup
Logger.info('Rate limiting configuration loaded', {
  enabled: !shouldSkipRateLimiting,
  isTestEnvironment,
  rateLimitingDisabled,
  sync: {
    windowMs: syncRateLimitConfig.windowMs,
    maxRequests: syncRateLimitConfig.max
  },
  playlists: {
    windowMs: playlistsRateLimitConfig.windowMs,
    maxRequests: playlistsRateLimitConfig.max
  }
});
