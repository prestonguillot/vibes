/**
 * Unit tests for the YouTube write layer (src/utils/youtubeWrites.ts):
 * every write goes through the circuit breaker, quota cost is counted, and a
 * quota-exceeded (403) opens the breaker and surfaces as YoutubeQuotaError.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/circuitBreaker', () => ({
  youtubeCircuitBreaker: {
    canProceed: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    open: vi.fn(),
  },
}));

import { youtubeCircuitBreaker } from '../../src/utils/circuitBreaker';
import {
  youtubeWrite,
  YoutubeQuotaError,
  YOUTUBE_WRITE_COST,
  getYoutubeWriteQuotaUsed,
  resetYoutubeWriteQuotaCounter,
} from '../../src/utils/youtubeWrites';

const breaker = vi.mocked(youtubeCircuitBreaker);

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
    const quotaError = { code: 403, errors: [{ reason: 'quotaExceeded' }] };
    const write = vi.fn(() => Promise.reject(quotaError));

    await expect(youtubeWrite('playlists.insert', write)).rejects.toBeInstanceOf(YoutubeQuotaError);
    expect(breaker.open).toHaveBeenCalledOnce();
    expect(breaker.recordFailure).not.toHaveBeenCalled();
  });

  it('treats a bare 403 (no reason) as quota too', async () => {
    const write = vi.fn(() => Promise.reject({ code: 403 }));
    await expect(youtubeWrite('playlistItems.delete', write)).rejects.toBeInstanceOf(
      YoutubeQuotaError,
    );
    expect(breaker.open).toHaveBeenCalledOnce();
  });

  it('records a failure and rethrows the original error for non-quota failures', async () => {
    const serverError = { code: 500, message: 'boom' };
    const write = vi.fn(() => Promise.reject(serverError));

    await expect(youtubeWrite('playlistItems.update', write)).rejects.toBe(serverError);
    expect(breaker.recordFailure).toHaveBeenCalledOnce();
    expect(breaker.open).not.toHaveBeenCalled();
  });
});
