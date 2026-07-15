/**
 * Tests for src/auth/csrfSecret.ts.
 *
 * The secret must be identical across instances or every signed CSRF cookie breaks on the next
 * request that lands elsewhere - hence the hard failure in production rather than a quiet
 * per-instance secret.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initializeCsrfSecret } from '../../src/auth/csrfSecret';
import { Logger } from '../../src/lib/logger';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe('initializeCsrfSecret in production', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'production'));

  it('refuses to start without CSRF_SECRET', () => {
    vi.stubEnv('CSRF_SECRET', undefined as unknown as string);

    expect(() => initializeCsrfSecret()).toThrow(/CSRF_SECRET environment variable must be set/);
  });

  it('refuses to start with an empty CSRF_SECRET', () => {
    vi.stubEnv('CSRF_SECRET', '');

    expect(() => initializeCsrfSecret()).toThrow(/must be set in production/);
  });

  it('uses the configured secret', () => {
    vi.stubEnv('CSRF_SECRET', 'the-production-secret');

    expect(initializeCsrfSecret()).toBe('the-production-secret');
  });

  it('never generates a secret in production', () => {
    vi.stubEnv('CSRF_SECRET', undefined as unknown as string);

    expect(() => initializeCsrfSecret()).toThrow();
    expect(Logger.warn).not.toHaveBeenCalled();
  });
});

describe('initializeCsrfSecret outside production', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));

  it('uses the configured secret when there is one', () => {
    vi.stubEnv('CSRF_SECRET', 'the-dev-secret');

    expect(initializeCsrfSecret()).toBe('the-dev-secret');
    expect(Logger.warn).not.toHaveBeenCalled();
  });

  it('generates 32 bytes of hex when there is none', () => {
    vi.stubEnv('CSRF_SECRET', undefined as unknown as string);

    expect(initializeCsrfSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('warns that a generated secret is not persisted', () => {
    vi.stubEnv('CSRF_SECRET', undefined as unknown as string);

    initializeCsrfSecret();

    expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('temporary CSRF secret'));
  });

  it('generates a different secret each time - which is exactly why production forbids it', () => {
    vi.stubEnv('CSRF_SECRET', undefined as unknown as string);

    expect(initializeCsrfSecret()).not.toBe(initializeCsrfSecret());
  });
});

describe('getCsrfSecret', () => {
  // The cache is module state, so each test needs a fresh module.
  const freshModule = async () => {
    vi.resetModules();
    return import('../../src/auth/csrfSecret');
  };

  it('computes the secret once and reuses it', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CSRF_SECRET', undefined as unknown as string);
    const { getCsrfSecret } = await freshModule();

    // Generated secrets are random, so identical return values prove memoization.
    expect(getCsrfSecret()).toBe(getCsrfSecret());
  });

  it('returns the configured secret', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CSRF_SECRET', 'configured');
    const { getCsrfSecret } = await freshModule();

    expect(getCsrfSecret()).toBe('configured');
  });

  it('propagates the production failure rather than caching a bad value', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CSRF_SECRET', undefined as unknown as string);
    const { getCsrfSecret } = await freshModule();

    expect(() => getCsrfSecret()).toThrow(/must be set in production/);
    expect(() => getCsrfSecret()).toThrow(/must be set in production/);
  });
});
