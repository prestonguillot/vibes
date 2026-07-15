/**
 * Unit tests for the YouTube write layer (src/youtube/writes.ts):
 * every write goes through the circuit breaker, quota cost is counted, and a
 * quota-exceeded (403) opens the breaker and surfaces as YoutubeQuotaError.
 *
 * Errors here are YoutubeApiError, which is the ONLY thing the hand-written client throws. A
 * googleapis-shaped literal ({ code, errors: [{ reason }] }) is not a shape anything produces, and
 * the classification would read an always-undefined reason from it.
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

// The backoff between retries is asserted on rather than served: serving it would put seconds of
// real sleeping in the suite for no added coverage.
const h = vi.hoisted(() => ({ sleep: vi.fn((_ms: number) => Promise.resolve()) }));
vi.mock('../../src/lib/delay', () => ({ sleep: h.sleep }));

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

  // A bare 403 during OAuth is far more likely permissions or consent than quota - calling it
  // quota sends the user off to wait for a midnight reset that will not fix it.
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

/**
 * A run of rapid playlist writes draws 409 SERVICE_UNAVAILABLE - "the operation was aborted" -
 * out of YouTube. It is a conflict, not a refusal: the same write succeeds a moment later.
 *
 * Giving up on the first one abandoned a reorder a quarter of the way through, which spends the
 * quota and leaves the playlist in neither the old order nor the new - so the next attempt has more
 * to undo than this one did.
 */
describe('youtubeWrite: failures that pass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetYoutubeWriteQuotaCounter();
    breaker.canProceed.mockReturnValue(true);
  });

  it('tries a 409 again, and reports the success', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(apiError(409, 'SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce('done');

    await expect(youtubeWrite('playlistItems.update', write)).resolves.toBe('done');

    expect(write).toHaveBeenCalledTimes(2);
    expect(breaker.recordSuccess).toHaveBeenCalledOnce();
    // A write that eventually worked is not a failure the breaker should count towards opening.
    expect(breaker.recordFailure).not.toHaveBeenCalled();
  });

  it('charges quota once for a write that took two attempts', async () => {
    const write = vi.fn().mockRejectedValueOnce(apiError(409)).mockResolvedValueOnce('done');

    await youtubeWrite('playlistItems.update', write);

    expect(getYoutubeWriteQuotaUsed()).toBe(YOUTUBE_WRITE_COST);
  });

  it('backs off further each time rather than hammering', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(apiError(409))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce('done');

    await youtubeWrite('playlistItems.update', write);

    expect(h.sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it.each([
    ['a 409 conflict', apiError(409, 'SERVICE_UNAVAILABLE')],
    ['a 503 from YouTube itself', apiError(503)],
    ['a 500 from YouTube itself', apiError(500)],
    ['a short-window rate limit', apiError(403, 'rateLimitExceeded')],
  ])('tries again after %s', async (_label, error) => {
    const write = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('done');

    await expect(youtubeWrite('playlistItems.update', write)).resolves.toBe('done');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the daily quota being gone', apiError(403, 'quotaExceeded')],
    ['a permission problem', apiError(403, 'insufficientPermissions')],
    ['a video that cannot be added', apiError(400, 'invalidVideoId')],
    ['a playlist that is not there', apiError(404)],
  ])('does not try again after %s', async (_label, error) => {
    const write = vi.fn().mockRejectedValue(error);

    await expect(youtubeWrite('playlistItems.update', write)).rejects.toThrow();
    expect(write).toHaveBeenCalledTimes(1);
    expect(h.sleep).not.toHaveBeenCalled();
  });

  it('gives up rather than retrying forever, and says what beat it', async () => {
    const write = vi.fn().mockRejectedValue(apiError(409, 'SERVICE_UNAVAILABLE'));

    await expect(youtubeWrite('playlistItems.update', write)).rejects.toMatchObject({ code: 409 });

    expect(write).toHaveBeenCalledTimes(4);
    // Only now, having actually given up, does the breaker hear about it.
    expect(breaker.recordFailure).toHaveBeenCalledOnce();
  });

  it('charges no quota for a write that never landed', async () => {
    const write = vi.fn().mockRejectedValue(apiError(409));

    await expect(youtubeWrite('playlistItems.update', write)).rejects.toThrow();

    expect(getYoutubeWriteQuotaUsed()).toBe(0);
  });
});
