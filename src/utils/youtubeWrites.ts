import { youtubeCircuitBreaker } from './circuitBreaker';
import { Logger } from './logger';

/**
 * Single choke point for every YouTube write (playlistItems insert/update/delete,
 * playlists.insert). Each write is gated by the YouTube circuit breaker, has its
 * quota cost accounted for, and turns a quota-exceeded (403) response into an
 * open breaker + a typed error so callers can stop early instead of hammering
 * the API with more 50-unit writes after the daily budget is gone.
 */

/** Quota units charged by a YouTube write operation (reads are 1 unit). */
export const YOUTUBE_WRITE_COST = 50;

/** Thrown when a write is refused (breaker open) or YouTube reports quota exceeded. */
export class YoutubeQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YoutubeQuotaError';
  }
}

let quotaUnitsUsed = 0;

/** Quota units spent on writes since the last reset (diagnostics/tests). */
export function getYoutubeWriteQuotaUsed(): number {
  return quotaUnitsUsed;
}

export function resetYoutubeWriteQuotaCounter(): void {
  quotaUnitsUsed = 0;
}

function isQuotaExceeded(error: unknown): boolean {
  const err = error as {
    code?: number;
    response?: { status?: number };
    errors?: Array<{ reason?: string }>;
  };
  const status = err?.code ?? err?.response?.status;
  if (status !== 403) return false;
  const reason = err?.errors?.[0]?.reason;
  // A 403 on a write to the user's own playlist is effectively always quota.
  return !reason || reason === 'quotaExceeded' || reason === 'rateLimitExceeded';
}

/**
 * Run a YouTube write through the circuit breaker. Refuses immediately if the
 * breaker is open; records success/failure; on quota-exceeded opens the breaker
 * and throws YoutubeQuotaError.
 *
 * @param operation Label for logging (e.g. 'playlistItems.insert').
 * @param write The actual googleapis write call.
 */
export async function youtubeWrite<T>(operation: string, write: () => Promise<T>): Promise<T> {
  if (!youtubeCircuitBreaker.canProceed()) {
    throw new YoutubeQuotaError(`YouTube write refused - circuit breaker open (${operation})`);
  }

  try {
    const result = await write();
    youtubeCircuitBreaker.recordSuccess();
    quotaUnitsUsed += YOUTUBE_WRITE_COST;
    Logger.external('YouTube', `write ${operation}`, {
      quotaCost: YOUTUBE_WRITE_COST,
      quotaUnitsUsed,
    });
    return result;
  } catch (error) {
    if (isQuotaExceeded(error)) {
      youtubeCircuitBreaker.open();
      Logger.warn('YouTube quota exceeded on write - opening circuit breaker', { operation });
      throw new YoutubeQuotaError(`YouTube quota exceeded during ${operation}`);
    }
    youtubeCircuitBreaker.recordFailure(error);
    throw error;
  }
}
