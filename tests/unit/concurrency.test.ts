/**
 * Tests for src/lib/concurrency.ts.
 *
 * mapWithConcurrency exists to do one thing Promise.all won't: run at most `limit` of the work
 * functions at a time, so a per-playlist fan-out doesn't burst the other API into a 429. Its other
 * promise is that results come back in input order regardless of which finished first. Both are
 * pinned here, along with the limit guard.
 */

import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency } from '../../src/lib/concurrency';

/** Resolve after `ms`, so tests can control which work functions finish first. */
const after = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('returns results in input order, not the order they finished', async () => {
    // The first item finishes last, the second finishes first - the output must still be a,b,c.
    const items = [
      { id: 'a', delay: 15 },
      { id: 'b', delay: 1 },
      { id: 'c', delay: 8 },
    ];

    const result = await mapWithConcurrency(items, 3, async (item) => {
      await after(item.delay);
      return item.id;
    });

    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('never runs more than `limit` work functions at once', async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 6 }), 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await after(2);
      active--;
      return null;
    });

    expect(peak).toBe(2);
  });

  it('spawns no more workers than there are items when items are fewer than the limit', async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2], 10, async () => {
      active++;
      peak = Math.max(peak, active);
      await after(2);
      active--;
      return null;
    });

    expect(peak).toBe(2);
  });

  it('passes each item together with its index', async () => {
    const seen: Array<[string, number]> = [];

    const result = await mapWithConcurrency(['x', 'y', 'z'], 2, async (item, index) => {
      seen.push([item, index]);
      return index;
    });

    expect(result).toEqual([0, 1, 2]);
    expect(seen).toContainEqual(['x', 0]);
    expect(seen).toContainEqual(['y', 1]);
    expect(seen).toContainEqual(['z', 2]);
  });

  it('runs fully sequentially at a limit of 1', async () => {
    const started: number[] = [];

    const result = await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      started.push(n);
      await after(1);
      return n * 2;
    });

    expect(result).toEqual([2, 4, 6]);
    // A limit of 1 must be accepted (the guard is `< 1`, not `<= 1`) and must serialize the work.
    expect(started).toEqual([1, 2, 3]);
  });

  it('returns an empty array for no items, without calling work', async () => {
    const work = vi.fn(async (n: number) => n);

    const result = await mapWithConcurrency([], 3, work);

    expect(result).toEqual([]);
    expect(work).not.toHaveBeenCalled();
  });

  it.each([0, -1, -5])(
    'rejects with a RangeError naming the bad limit when limit is %i',
    async (limit) => {
      await expect(mapWithConcurrency([1, 2], limit, async (n) => n)).rejects.toThrow(RangeError);
      await expect(mapWithConcurrency([1, 2], limit, async (n) => n)).rejects.toThrow(
        new RegExp(`at least 1, got ${limit}`),
      );
    },
  );
});
