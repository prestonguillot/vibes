/**
 * Tests for src/lib/envValidation.ts.
 *
 * validateEnvironment() is the app's startup gate: server.ts calls it before anything else, and the
 * throw is what stops a misconfigured server from booting.
 *
 * The schema it gates on - which vars are required, and what makes each one valid - is a table
 * built as the module loads. Imported at the top of this file that happens before any test runs, so
 * all 29 of its mutants belong to no test, and with ignoreStatic on they are not scored at all.
 * Loading the module inside a test puts the table in that test's coverage, so the assertions below
 * are credited with what they already check.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { validateEnvironment as ValidateEnvironment } from '../../src/lib/envValidation';
import type { Logger as LoggerType } from '../../src/lib/logger';

// Both come from the same fresh module registry, per test. Resetting the registry gives
// envValidation a new Logger too, so a spy on one imported up here would be watching an object the
// code under test no longer calls.
let validateEnvironment: typeof ValidateEnvironment;
let Logger: typeof LoggerType;

const REQUIRED = {
  SPOTIFY_CLIENT_ID: 'spotify-id',
  SPOTIFY_CLIENT_SECRET: 'spotify-secret',
  SPOTIFY_REDIRECT_URI: 'https://example.com/callback/spotify',
  YOUTUBE_CLIENT_ID: 'youtube-id',
  YOUTUBE_CLIENT_SECRET: 'youtube-secret',
  YOUTUBE_REDIRECT_URI: 'https://example.com/callback/youtube',
};

/** Set exactly the given vars and nothing else, so a test's requirements are visible in the test. */
function env(vars: Record<string, string | undefined>) {
  for (const key of [...Object.keys(REQUIRED), 'NODE_ENV', 'PORT', 'CSRF_SECRET']) {
    vi.stubEnv(key, undefined as unknown as string);
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) vi.stubEnv(key, value);
  }
}

const warnings = () =>
  vi.mocked(Logger.warn).mock.calls.map(([, context]) => (context as { warning: string }).warning);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();

  ({ Logger } = await import('../../src/lib/logger'));
  vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
  vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
  vi.spyOn(Logger, 'debug').mockImplementation(() => undefined);

  ({ validateEnvironment } = await import('../../src/lib/envValidation'));
});

afterEach(() => vi.unstubAllEnvs());

describe('validateEnvironment: required variables', () => {
  it('passes when every required variable is set', () => {
    env(REQUIRED);

    expect(() => validateEnvironment()).not.toThrow();
  });

  it.each(Object.keys(REQUIRED))('throws when %s is missing, naming what it is', (key) => {
    env({ ...REQUIRED, [key]: undefined });

    try {
      validateEnvironment();
      throw new Error('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      // An operator reads this to fix a failed boot, so the message must name the variable AND
      // describe it. A blank description reads as "SPOTIFY_CLIENT_ID ()"; a dropped schema entry
      // reads as "(undefined)" - both are worse messages than the real one.
      expect(message).toMatch(new RegExp(`Missing required environment variable: ${key} \\(.+\\)`));
      expect(message).not.toContain('(undefined)');
    }
  });

  it('names every missing variable, not just the first', () => {
    env({});

    try {
      validateEnvironment();
      throw new Error('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      for (const key of Object.keys(REQUIRED)) expect(message).toContain(key);
      // The errors are listed one per line, not run together into one unreadable string. (Checking
      // line count, not just for a '\n' - the "failed:\n" prefix already carries one newline.)
      expect(message.split('\n').length).toBeGreaterThan(Object.keys(REQUIRED).length);
    }
  });

  // A missing var is reported as missing and NOT also as invalid - the loop continues past it.
  it('reports a missing variable once, as missing rather than invalid', () => {
    env({ ...REQUIRED, SPOTIFY_CLIENT_ID: undefined });

    try {
      validateEnvironment();
      throw new Error('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('Missing required environment variable: SPOTIFY_CLIENT_ID');
      expect(message).not.toContain('Invalid value for SPOTIFY_CLIENT_ID');
    }
  });
});

describe('validateEnvironment: value validation', () => {
  it.each(['SPOTIFY_REDIRECT_URI', 'YOUTUBE_REDIRECT_URI'])(
    'rejects %s when it is not an http(s) URL',
    (key) => {
      env({ ...REQUIRED, [key]: 'ftp://example.com/callback' });

      expect(() => validateEnvironment()).toThrow(new RegExp(`Invalid value for ${key}`));
    },
  );

  it.each(['http://localhost:3000/callback', 'https://example.com/callback'])(
    'accepts the redirect URI %s',
    (uri) => {
      env({ ...REQUIRED, SPOTIFY_REDIRECT_URI: uri });

      expect(() => validateEnvironment()).not.toThrow();
    },
  );

  // An empty string is falsy, so it is caught by the missing check before validate() ever runs.
  it('treats an empty value as missing', () => {
    env({ ...REQUIRED, SPOTIFY_CLIENT_ID: '' });

    expect(() => validateEnvironment()).toThrow(/Missing required.*SPOTIFY_CLIENT_ID/);
  });
});

describe('validateEnvironment: optional variables', () => {
  it('warns about an optional variable that has no default, describing it', () => {
    env(REQUIRED); // CSRF_SECRET unset, and it has no defaultValue

    validateEnvironment();

    const csrfWarning = warnings().find((w) => w.includes('CSRF_SECRET'));
    // Same standard as the required-var errors: name it and describe it, don't print "(undefined)".
    expect(csrfWarning).toMatch(/CSRF_SECRET \(.+\)/);
    expect(csrfWarning).not.toContain('undefined');
  });

  it.each(['PORT', 'NODE_ENV'])('does not warn about %s, which has a default', (key) => {
    env(REQUIRED);

    validateEnvironment();

    expect(warnings().filter((w) => w.includes(key))).toHaveLength(0);
  });

  it('does not warn when the optional variable is set', () => {
    env({ ...REQUIRED, CSRF_SECRET: 'a-real-secret' });

    validateEnvironment();

    expect(warnings().filter((w) => w.includes('CSRF_SECRET'))).toHaveLength(0);
  });

  it('never throws for a warning', () => {
    env(REQUIRED);

    expect(() => validateEnvironment()).not.toThrow();
  });
});

describe('validateEnvironment: production checks', () => {
  it('requires CSRF_SECRET in production', () => {
    env({ ...REQUIRED, NODE_ENV: 'production' });

    expect(() => validateEnvironment()).toThrow(/CSRF_SECRET must be set in production/);
  });

  it('accepts production once CSRF_SECRET is set', () => {
    env({ ...REQUIRED, NODE_ENV: 'production', CSRF_SECRET: 'a-real-secret' });

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('does not require CSRF_SECRET outside production', () => {
    env({ ...REQUIRED, NODE_ENV: 'development' });

    expect(() => validateEnvironment()).not.toThrow();
  });

  // A localhost redirect in production is a warning, NOT an error: it must not stop the boot.
  it.each([
    ['SPOTIFY_REDIRECT_URI', 'http://localhost:3000/callback'],
    ['SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/callback'],
    ['YOUTUBE_REDIRECT_URI', 'http://localhost:3000/callback'],
    ['YOUTUBE_REDIRECT_URI', 'http://127.0.0.1:3000/callback'],
  ])('warns (without throwing) about %s = %s in production', (key, uri) => {
    env({ ...REQUIRED, NODE_ENV: 'production', CSRF_SECRET: 'secret', [key]: uri });

    expect(() => validateEnvironment()).not.toThrow();
    expect(warnings()).toContainEqual(expect.stringContaining(key));
  });

  it('does not warn about localhost outside production', () => {
    env({ ...REQUIRED, NODE_ENV: 'development', SPOTIFY_REDIRECT_URI: 'http://localhost:3000/cb' });

    validateEnvironment();

    expect(warnings().filter((w) => w.includes('localhost'))).toHaveLength(0);
  });

  it('does not warn about a production-domain redirect URI', () => {
    env({ ...REQUIRED, NODE_ENV: 'production', CSRF_SECRET: 'secret' });

    validateEnvironment();

    expect(warnings().filter((w) => w.includes('REDIRECT_URI'))).toHaveLength(0);
  });

  // The production block reads the redirect URIs to look for localhost. They are required, so a
  // missing one is already an error - and the `?.` is what lets that error be reported instead of
  // `undefined.includes(...)` throwing a TypeError first and masking the real problem.
  it.each(['SPOTIFY_REDIRECT_URI', 'YOUTUBE_REDIRECT_URI'])(
    'reports a missing %s in production as missing, not a TypeError',
    (key) => {
      env({ ...REQUIRED, NODE_ENV: 'production', CSRF_SECRET: 'secret', [key]: undefined });

      expect(() => validateEnvironment()).toThrow(new RegExp(`Missing required.*${key}`));
    },
  );
});

describe('validateEnvironment: what it logs', () => {
  it('emits no warnings when every variable is valid', () => {
    env({ ...REQUIRED, CSRF_SECRET: 'a-real-secret' });

    validateEnvironment();

    expect(warnings()).toHaveLength(0);
  });

  it('logs a debug line naming each defaulted optional variable', () => {
    env({ ...REQUIRED, CSRF_SECRET: 'a-real-secret' }); // PORT and NODE_ENV fall back to defaults

    validateEnvironment();

    expect(Logger.debug).toHaveBeenCalledWith('Using default for PORT', {
      default: '3000',
      description: 'Server port',
    });
    expect(Logger.debug).toHaveBeenCalledWith('Using default for NODE_ENV', {
      default: 'development',
      description: 'Node environment (development/production)',
    });
  });

  it('logs the error list when validation fails', () => {
    env({});

    expect(() => validateEnvironment()).toThrow();

    expect(Logger.error).toHaveBeenCalledWith(
      'Environment validation failed',
      expect.objectContaining({
        errorCount: Object.keys(REQUIRED).length,
        errors: expect.arrayContaining([expect.stringContaining('SPOTIFY_CLIENT_ID')]),
      }),
    );
  });

  it('logs a passing summary carrying the variable counts', () => {
    env({ ...REQUIRED, CSRF_SECRET: 'a-real-secret' });

    validateEnvironment();

    expect(Logger.info).toHaveBeenCalledWith(
      'Environment validation passed ✓',
      expect.objectContaining({ requiredVars: 6, optionalVars: 3, warnings: 0 }),
    );
  });
});
