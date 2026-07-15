/**
 * Tests for src/lib/cache.ts.
 *
 * These durations decide how long a browser reuses a response, so a wrong one surfaces as stale
 * playlists nobody can explain, or as extra API calls against a quota that has caused outages.
 * Route integration tests execute this module without asserting a single Cache-Control header, so
 * the values are only actually pinned here.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { CacheDuration, setCache } from '../../src/lib/cache';

const fakeRes = () => {
  const set = vi.fn();
  return { res: { set } as unknown as Response, set };
};

describe('setCache', () => {
  it('sends no-cache for real-time responses', () => {
    const { res, set } = fakeRes();

    setCache(res, CacheDuration.NO_CACHE);

    expect(set).toHaveBeenCalledWith('Cache-Control', 'no-cache');
  });

  it.each([
    [CacheDuration.SHORT, 'private, max-age=300'],
    [CacheDuration.MEDIUM, 'private, max-age=600'],
    [CacheDuration.LONG, 'private, max-age=1800'],
    [CacheDuration.VERY_LONG, 'private, max-age=3600'],
  ])('sends private, max-age=%s for a duration', (duration, expected) => {
    const { res, set } = fakeRes();

    setCache(res, duration);

    expect(set).toHaveBeenCalledWith('Cache-Control', expected);
  });

  // `private` is not decoration: these responses carry one user's playlists, so a shared cache
  // must never store them.
  it('always marks a cacheable response private', () => {
    const { res, set } = fakeRes();

    setCache(res, 600);

    expect(set.mock.calls[0]![1]).toContain('private');
  });

  it('sets exactly one header', () => {
    const { res, set } = fakeRes();

    setCache(res, 600);

    expect(set).toHaveBeenCalledOnce();
  });

  it('handles a zero duration as a duration, not as no-cache', () => {
    const { res, set } = fakeRes();

    setCache(res, 0);

    expect(set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=0');
  });
});

describe('CacheDuration', () => {
  // These are a contract with the rationale documented in the module: LONG exists to cut YouTube
  // quota usage, NO_CACHE keeps SSE streams live. Changing one silently changes behaviour across
  // every route that uses it.
  it('pins the documented durations, in seconds', () => {
    expect(CacheDuration).toEqual({
      NO_CACHE: 'no-cache',
      SHORT: 300,
      MEDIUM: 600,
      LONG: 1800,
      VERY_LONG: 3600,
    });
  });

  it('orders the durations shortest to longest', () => {
    expect(CacheDuration.SHORT).toBeLessThan(CacheDuration.MEDIUM);
    expect(CacheDuration.MEDIUM).toBeLessThan(CacheDuration.LONG);
    expect(CacheDuration.LONG).toBeLessThan(CacheDuration.VERY_LONG);
  });
});
