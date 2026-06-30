import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enforceMinDisplayTime, MIN_DISPLAY_TIME_MS } from '@/lib/minDisplayTime';

// Fake timers make this deterministic - no wall-clock measurement, no real waiting.
describe('enforceMinDisplayTime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits the remaining time when the work finished early', async () => {
    const start = Date.now();
    vi.advanceTimersByTime(100); // simulate 100ms of work

    let resolved = false;
    const pending = enforceMinDisplayTime(start).then(() => {
      resolved = true;
    });

    // Just before the minimum: still waiting.
    await vi.advanceTimersByTimeAsync(MIN_DISPLAY_TIME_MS - 100 - 1);
    expect(resolved).toBe(false);

    // Crossing the minimum: resolves.
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });

  it('resolves immediately when the work already exceeded the minimum', async () => {
    const start = Date.now();
    vi.advanceTimersByTime(MIN_DISPLAY_TIME_MS + 50); // work took longer than the minimum

    let resolved = false;
    const pending = enforceMinDisplayTime(start).then(() => {
      resolved = true;
    });

    // No timer is pending; it resolves on the next microtask without advancing time.
    await pending;
    expect(resolved).toBe(true);
  });
});
