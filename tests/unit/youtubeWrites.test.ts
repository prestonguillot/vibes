/**
 * Unit tests for the YouTube write layer (src/youtube/writes.ts):
 * every write goes through the circuit breaker, quota cost is counted, and a
 * quota-exceeded (403) opens the breaker and surfaces as YoutubeQuotaError.
 *
 * Errors here are YoutubeApiError, which is the ONLY thing the hand-written client throws. These
 * tests previously built googleapis-shaped literals ({ code, errors: [{ reason }] }) - a shape
 * nothing has produced since that dependency was dropped - so they passed while the real
 * classification read an always-undefined reason and never opened the breaker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/circuitBreaker', () => ({
  youtubeCircuitBreaker: {
    canProceed: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    open: vi.fn(),
  },
}));

import { youtubeCircuitBreaker } from '../../src/lib/circuitBreaker';
import { YoutubeApiError } from '../../src/youtube/client';
import {
  youtubeWrite,
  classifyYoutubeError,
  YoutubeQuotaError,
  YOUTUBE_WRITE_COST,
  getYoutubeWriteQuotaUsed,
  resetYoutubeWriteQuotaCounter,
} from '../../src/youtube/writes';

const breaker = vi.mocked(youtubeCircuitBreaker);

/** Exactly what src/youtube/client.ts throws for a non-ok response. */
const apiError = (code: number, reason?: string) =>
  new YoutubeApiError(`YouTube API error (${code})`, code, reason);

describe('youtubeWrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetYoutubeWriteQuotaCounter();
    breaker.canProceed.mockReturnValue(true);
  });

  it('runs the write, records success, and counts quota when the breaker is closed', async () => {
    const write = vi.fn(() => Promise.resolve('result'));
    const result = await youtubeWrite('playlistItems.insert', write);

    expect(result).toBe('result');
    expect(write).toHaveBeenCalledOnce();
    expect(breaker.recordSuccess).toHaveBeenCalledOnce();
    expect(getYoutubeWriteQuotaUsed()).toBe(YOUTUBE_WRITE_COST);
  });

  it('refuses without calling the write when the breaker is open', async () => {
    breaker.canProceed.mockReturnValue(false);
    const write = vi.fn(() => Promise.resolve('result'));

    await expect(youtubeWrite('playlistItems.insert', write)).rejects.toBeInstanceOf(
      YoutubeQuotaError,
    );
    expect(write).not.toHaveBeenCalled();
    expect(getYoutubeWriteQuotaUsed()).toBe(0);
  });

  it('opens the breaker and throws YoutubeQuotaError on a 403 quotaExceeded', async () => {
    const quotaError = apiError(403, 'quotaExceeded');
    const write = vi.fn(() => Promise.reject(quotaError));

    await expect(youtubeWrite('playlists.insert', write)).rejects.toBeInstanceOf(YoutubeQuotaError);
    expect(breaker.open).toHaveBeenCalledOnce();
    expect(breaker.recordFailure).not.toHaveBeenCalled();
  });

  it('opens the breaker and throws YoutubeQuotaError on a 403 dailyLimitExceeded', async () => {
    const write = vi.fn(() => Promise.reject(apiError(403, 'dailyLimitExceeded')));

    await expect(youtubeWrite('playlists.insert', write)).rejects.toBeInstanceOf(YoutubeQuotaError);
    expect(breaker.open).toHaveBeenCalledOnce();
  });

  // A bare 403 is NOT necessarily quota - it can be insufficientPermissions, forbidden, or a
  // video-specific rejection. Reporting it as quota opened the breaker for 15 minutes and hid the
  // real cause. It must surface as itself.
  it('does NOT treat a bare 403 (no reason) as quota - rethrows the original, breaker stays closed', async () => {
    const bare403 = apiError(403);
    const write = vi.fn(() => Promise.reject(bare403));

    await expect(youtubeWrite('playlistItems.delete', write)).rejects.toBe(bare403);
    expect(breaker.open).not.toHaveBeenCalled();
    expect(breaker.recordFailure).toHaveBeenCalledOnce();
  });

  // rateLimitExceeded is a short-window throttle (retryable), not the daily budget - opening the
  // breaker over it needlessly kills the whole run.
  it('does NOT treat 403 rateLimitExceeded as daily quota', async () => {
    const throttled = apiError(403, 'rateLimitExceeded');
    const write = vi.fn(() => Promise.reject(throttled));

    await expect(youtubeWrite('playlistItems.insert', write)).rejects.toBe(throttled);
    expect(breaker.open).not.toHaveBeenCalled();
    expect(breaker.recordFailure).toHaveBeenCalledOnce();
  });

  it('records a failure and rethrows the original error for non-quota failures', async () => {
    const serverError = apiError(500);
    const write = vi.fn(() => Promise.reject(serverError));

    await expect(youtubeWrite('playlistItems.update', write)).rejects.toBe(serverError);
    expect(breaker.recordFailure).toHaveBeenCalledOnce();
    expect(breaker.open).not.toHaveBeenCalled();
  });
});

/**
 * The routes classify READ errors with this too (sync, playlistDetails, the OAuth callback), so
 * one definition of "quota" serves every caller instead of the three that had drifted apart.
 */
describe('classifyYoutubeError', () => {
  it('treats a quota error a write already classified as quota', () => {
    expect(classifyYoutubeError(new YoutubeQuotaError('breaker open'))).toBe('quota');
  });

  it.each([['quotaExceeded'], ['dailyLimitExceeded']])(
    'treats a 403 %s as the daily budget being gone',
    (reason) => {
      expect(classifyYoutubeError(apiError(403, reason))).toBe('quota');
    },
  );

  it.each([['rateLimitExceeded'], ['userRateLimitExceeded']])(
    'treats a 403 %s as a transient throttle, not quota',
    (reason) => {
      expect(classifyYoutubeError(apiError(403, reason))).toBe('rate-limit');
    },
  );

  // The OAuth callback used to call ANY 403 quota_exceeded, telling the user to wait for a
  // midnight reset when the real cause was likely permissions or consent.
  it('does not treat a bare 403 as quota', () => {
    expect(classifyYoutubeError(apiError(403))).toBe('other');
  });

  it('does not treat a 403 with an unrelated reason as quota', () => {
    expect(classifyYoutubeError(apiError(403, 'insufficientPermissions'))).toBe('other');
  });

  it.each([[401], [404], [500]])('treats a %i as other', (code) => {
    expect(classifyYoutubeError(apiError(code, 'quotaExceeded'))).toBe('other');
  });

  it('tolerates errors that are not YouTube API errors at all', () => {
    expect(classifyYoutubeError(new Error('socket hang up'))).toBe('other');
    expect(classifyYoutubeError(undefined)).toBe('other');
  });
});
