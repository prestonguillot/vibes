/**
 * Tests for src/lib/logger.ts.
 *
 * Worst-scoring module in the repo: 238 of 240 mutants survived (0.8%). The reason is structural -
 * vitest.config sets LOG_LEVEL=silent and the level is read at MODULE SCOPE, so by the time any
 * test imports the logger it is frozen at SILENT and log() returns before doing anything. Every
 * mutant inside the formatting and redaction was unreachable.
 *
 * The redaction is the part that matters: this app handles OAuth tokens, and sanitizeContext is
 * what keeps them out of the logs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getInitialLogLevel, LogLevel, Logger, sanitizeContext } from '../../src/lib/logger';

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  vi.unstubAllEnvs();
  Logger.setLevel(LogLevel.SILENT); // restore what vitest.config asks for
});

describe('getInitialLogLevel', () => {
  it.each([
    ['DEBUG', LogLevel.DEBUG],
    ['INFO', LogLevel.INFO],
    ['WARN', LogLevel.WARN],
    ['ERROR', LogLevel.ERROR],
    ['SILENT', LogLevel.SILENT],
  ])('reads LOG_LEVEL=%s', (env, expected) => {
    vi.stubEnv('LOG_LEVEL', env);

    expect(getInitialLogLevel()).toBe(expected);
  });

  it('is case-insensitive', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');

    expect(getInitialLogLevel()).toBe(LogLevel.WARN);
  });

  // Regression: a numeric enum carries REVERSE mappings, so `'0' in LogLevel` is true and
  // LogLevel['0'] is the STRING 'DEBUG'. Returning that left currentLogLevel holding a string,
  // `level < currentLogLevel` always false, and LOG_LEVEL=0 logging everything at every level -
  // including in production, where the default is meant to be INFO.
  it.each([['0'], ['1'], ['4']])('ignores the numeric LOG_LEVEL=%s and uses the default', (env) => {
    vi.stubEnv('LOG_LEVEL', env);
    vi.stubEnv('NODE_ENV', 'production');

    const level = getInitialLogLevel();

    expect(typeof level).toBe('number');
    expect(level).toBe(LogLevel.INFO); // the production default, not 'DEBUG'
  });

  it.each([['nonsense'], ['']])('falls back to the default for LOG_LEVEL=%o', (env) => {
    vi.stubEnv('LOG_LEVEL', env);
    vi.stubEnv('NODE_ENV', 'development');

    expect(getInitialLogLevel()).toBe(LogLevel.DEBUG);
  });

  it('defaults to INFO in production', () => {
    vi.stubEnv('LOG_LEVEL', undefined as unknown as string);
    vi.stubEnv('NODE_ENV', 'production');

    expect(getInitialLogLevel()).toBe(LogLevel.INFO);
  });

  it('defaults to DEBUG outside production', () => {
    vi.stubEnv('LOG_LEVEL', undefined as unknown as string);
    vi.stubEnv('NODE_ENV', 'development');

    expect(getInitialLogLevel()).toBe(LogLevel.DEBUG);
  });
});

describe('sanitizeContext', () => {
  it('leaves ordinary values alone', () => {
    expect(sanitizeContext({ playlistId: 'pl1', count: 42, ok: true })).toEqual({
      playlistId: 'pl1',
      count: 42,
      ok: true,
    });
  });

  it.each([
    ['accessToken'],
    ['access_token'],
    ['refreshToken'],
    ['refresh_token'],
    ['password'],
    ['secret'],
    ['apiKey'],
    ['api_key'],
    ['token'],
    ['tokens'],
    ['credentials'],
    ['authorization'],
    ['cookie'],
    ['cookies'],
  ])('redacts %s', (key) => {
    expect(sanitizeContext({ [key]: 'the-real-value' })).toEqual({ [key]: '[REDACTED]' });
  });

  // Substring + case-insensitive matching is what catches the real-world names.
  it.each([['spotifyAccessToken'], ['SPOTIFY_REFRESH_TOKEN'], ['userPassword'], ['csrfSecret']])(
    'redacts %s by substring, whatever its casing',
    (key) => {
      expect(sanitizeContext({ [key]: 'sensitive' })[key]).toBe('[REDACTED]');
    },
  );

  it('redacts inside nested objects', () => {
    expect(sanitizeContext({ user: { name: 'preston', accessToken: 'secret-value' } })).toEqual({
      user: { name: 'preston', accessToken: '[REDACTED]' },
    });
  });

  it('redacts a whole sensitive object rather than walking into it', () => {
    expect(sanitizeContext({ tokens: { accessToken: 'a', refreshToken: 'b' } })).toEqual({
      tokens: '[REDACTED]',
    });
  });

  it('does not mistake an innocent key for a sensitive one', () => {
    expect(sanitizeContext({ tokenCount: 5 }).tokenCount).toBe('[REDACTED]');
    expect(sanitizeContext({ playlistName: 'x' }).playlistName).toBe('x');
  });

  it('passes null and undefined through untouched', () => {
    expect(sanitizeContext({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
  });

  it('handles an empty context', () => {
    expect(sanitizeContext({})).toEqual({});
  });
});

describe('Logger level gating', () => {
  const spies = () => ({
    debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  });

  it('routes each level to the matching console method', () => {
    const c = spies();
    Logger.setLevel(LogLevel.DEBUG);

    Logger.debug('d');
    Logger.info('i');
    Logger.warn('w');
    Logger.error('e');

    expect(c.debug).toHaveBeenCalled();
    expect(c.log).toHaveBeenCalled();
    expect(c.warn).toHaveBeenCalled();
    expect(c.error).toHaveBeenCalled();
  });

  it('suppresses everything below the current level', () => {
    const c = spies();
    Logger.setLevel(LogLevel.WARN);

    Logger.debug('d');
    Logger.info('i');
    Logger.warn('w');

    expect(c.debug).not.toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
    expect(c.warn).toHaveBeenCalled();
  });

  it('says nothing at all when SILENT', () => {
    const c = spies();
    Logger.setLevel(LogLevel.SILENT);

    Logger.debug('d');
    Logger.info('i');
    Logger.warn('w');
    Logger.error('e');

    expect(c.debug).not.toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
    expect(c.warn).not.toHaveBeenCalled();
    expect(c.error).not.toHaveBeenCalled();
  });

  it('redacts a sensitive context on the way out', () => {
    const c = spies();
    Logger.setLevel(LogLevel.DEBUG);

    Logger.info('connected', { accessToken: 'super-secret-value' });

    const printed = c.log.mock.calls.flat().join(' ');
    expect(printed).not.toContain('super-secret-value');
    expect(printed).toContain('[REDACTED]');
  });
});
