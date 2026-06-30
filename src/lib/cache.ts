/**
 * Caching Strategy Configuration
 *
 * This module defines cache durations for different types of responses.
 * All cache durations are in seconds.
 *
 * Cache Strategy:
 * - API quota-sensitive: Longer cache (30 min) to minimize API calls
 * - Frequently changing: Shorter cache (5 min) for up-to-date data
 * - Real-time: No cache for dynamic/user-specific data
 * - Static: Long cache (1 hour+) for rarely changing content
 */

import { Response } from 'express';

export const CacheDuration = {
  /**
   * No caching - used for SSE streams and real-time data
   */
  NO_CACHE: 'no-cache',

  /**
   * 5 minutes - used for frequently updated data that needs to be relatively fresh
   * Example: User connection status
   */
  SHORT: 300,

  /**
   * 10 minutes - used for data that changes occasionally
   * Example: Playlist details (track lists can change)
   */
  MEDIUM: 600,

  /**
   * 30 minutes - used for API quota-sensitive operations
   * Example: Spotify playlists list (expensive to fetch, doesn't change often)
   * Rationale: Reduces YouTube API quota usage when checking sync status
   */
  LONG: 1800,

  /**
   * 1 hour - used for rarely changing data
   * Example: OAuth callback pages, static content
   */
  VERY_LONG: 3600,
} as const;

/**
 * Helper to set cache headers on Express response
 * @param res Express response object
 * @param duration Cache duration in seconds, or 'no-cache'
 */
export function setCache(res: Response, duration: number | 'no-cache'): void {
  if (duration === 'no-cache') {
    res.set('Cache-Control', 'no-cache');
  } else {
    res.set('Cache-Control', `private, max-age=${duration}`);
  }
}

/**
 * Rationale for cache durations:
 *
 * 1. Playlist Details (10 min / MEDIUM):
 *    - User may add/remove/reorder tracks frequently
 *    - Need balance between freshness and API quota
 *    - 10 minutes is reasonable for typical usage patterns
 *
 * 2. Spotify Playlists List (30 min / LONG):
 *    - List of playlists changes less frequently than playlist contents
 *    - Includes YouTube playlist lookup (expensive quota usage)
 *    - 30 minutes significantly reduces quota consumption
 *    - Users typically don't create new playlists every few minutes
 *
 * 3. SSE Progress Streams (no-cache):
 *    - Real-time sync progress must not be cached
 *    - Each connection needs fresh event stream
 *
 * 4. Refresh Buttons:
 *    - Use Cache-Control: no-cache header in HTMX request
 *    - Forces fresh fetch even if cache is valid
 */
