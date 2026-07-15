import { youtubeCircuitBreaker } from '../lib/circuitBreaker';
import { YoutubeApiError } from './client';
import { Logger } from '../lib/logger';
import { sleep } from '../lib/delay';

/**
 * Single choke point for every YouTube write (playlistItems insert/update/delete,
 * playlists.insert). Each write is gated by the YouTube circuit breaker, has its
 * quota cost accounted for, and turns a quota-exceeded (403) response into an
 * open breaker + a typed error so callers can stop early instead of hammering
 * the API with more 50-unit writes after the daily budget is gone.
 */

/** Quota units charged by a YouTube write operation (reads are 1 unit). */
export const YOUTUBE_WRITE_COST = 50;

/**
 * How many times a write that failed for a passing reason is tried again, and how long it waits
 * first (doubling each time).
 *
 * YouTube answers a run of rapid playlist writes with 409 SERVICE_UNAVAILABLE - "the operation was
 * aborted" - which is a conflict, not a refusal: the same write succeeds a moment later. Giving up
 * on the first one abandoned a reorder halfway through, which costs the quota already spent and
 * leaves the playlist in neither the old order nor the new.
 */
const MAX_WRITE_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = 500;

/** Failures that are about this moment rather than this request. */
function isTransient(status: number | undefined, failure: YoutubeFailure): boolean {
  if (failure === 'rate-limit') return true;
  // 409: concurrent modification. 500/503: YouTube itself.
  return status === 409 || status === 500 || status === 503;
}

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

/** What a YouTube failure actually was - a 403 is NOT automatically "quota". */
export type YoutubeFailure = 'quota' | 'rate-limit' | 'other';

/**
 * The status and reason YouTube gave, if this is a YouTube API error at all.
 *
 * YoutubeApiError is the only thing the client throws: it parses the reason out of the response
 * body and exposes it directly, so there is no nested `errors[0].reason` to read here.
 */
function youtubeErrorDetails(error: unknown): { status?: number; reason?: string } {
  if (!(error instanceof YoutubeApiError)) return {};
  return { status: error.code, reason: error.reason };
}

/**
 * Classify any YouTube failure, read or write, so one definition of "quota" serves every caller.
 *
 * Only quotaExceeded/dailyLimitExceeded mean the daily budget is gone. rateLimitExceeded is a
 * short-window throttle (retryable), and a bare 403 can be insufficientPermissions, forbidden, or
 * a video-specific rejection - reporting either as quota hides the real cause. This distinction is
 * only meaningful because youtubeErrorDetails can now actually read the reason.
 */
export function classifyYoutubeError(error: unknown): YoutubeFailure {
  // A write that already classified itself (or was refused by an open breaker).
  if (error instanceof YoutubeQuotaError) return 'quota';

  const { status, reason } = youtubeErrorDetails(error);
  if (status !== 403) return 'other';
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return 'quota';
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return 'rate-limit';
  return 'other';
}

/**
 * Run a YouTube write through the circuit breaker. Refuses immediately if the
 * breaker is open; records success/failure; on quota-exceeded opens the breaker
 * and throws YoutubeQuotaError.
 *
 * @param operation Label for logging (e.g. 'playlistItems.insert').
 * @param write The actual write call.
 */
export async function youtubeWrite<T>(operation: string, write: () => Promise<T>): Promise<T> {
  if (!youtubeCircuitBreaker.canProceed()) {
    throw new YoutubeQuotaError(`YouTube write refused - circuit breaker open (${operation})`);
  }

  for (let attempt = 1; ; attempt++) {
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
      const failure = classifyYoutubeError(error);
      const { status, reason } = youtubeErrorDetails(error);

      // Only a real daily-quota exhaustion justifies opening the breaker and aborting the run.
      if (failure === 'quota') {
        youtubeCircuitBreaker.open();
        Logger.warn(
          'YouTube daily quota exceeded on write - opening circuit breaker',
          { operation, status, reason },
          error,
        );
        throw new YoutubeQuotaError(`YouTube quota exceeded during ${operation}`);
      }

      if (isTransient(status, failure) && attempt < MAX_WRITE_ATTEMPTS) {
        const waitMs = RETRY_BACKOFF_MS * 2 ** (attempt - 1);
        Logger.warn(`YouTube write ${operation} hit a passing failure - retrying`, {
          operation,
          status,
          reason,
          attempt,
          of: MAX_WRITE_ATTEMPTS,
          waitMs,
        });
        await sleep(waitMs);
        continue;
      }

      // Everything else (permissions, an unknown 403, a transient one that never cleared) surfaces
      // as ITSELF, with the real error logged rather than discarded behind a misleading "quota
      // exceeded". The breaker only hears about it once the write has actually given up.
      youtubeCircuitBreaker.recordFailure(error);
      Logger.warn(
        `YouTube write failed (${failure})`,
        { operation, status, reason, attempt },
        error,
      );
      throw error;
    }
  }
}
