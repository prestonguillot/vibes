/**
 * Tests for src/lib/logger.ts.
 *
 * vitest.config sets LOG_LEVEL=silent and the level is read at MODULE SCOPE, so the logger is
 * frozen at SILENT by the time any test imports it and log() returns before doing anything. Tests
 * that need it to emit must call Logger.setLevel() themselves.
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

/**
 * The emoji is picked by matching the message text, and it is the first thing on every line - it is
 * how a log is skimmed. Every keyword below is a branch that ran on every log call this suite ever
 * made and that nothing ever looked at, so all of it survived: asserting only that console.log was
 * called leaves the choice of what to print unpinned.
 *
 * Asserted through the public API rather than by exporting the picker: what is being pinned is what
 * a line starts with, not that a function returns a string.
 */
describe('the emoji a message gets', () => {
  /** The emoji an info line actually starts with. */
  const emojiFor = (message: string, context: Record<string, unknown> = {}) => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    Logger.info(message, context);
    const line = String(spy.mock.calls.at(-1)?.[0] ?? '');
    return line.split(' ')[0];
  };

  beforeEach(() => Logger.setLevel(LogLevel.DEBUG));

  it.each([
    ['🚀', 'server', ['server booting', 'started listening', 'running on port 3000']],
    ['🔐', 'auth', ['auth failed', 'token refreshed', 'login redirect']],
    ['🌐', 'external', ['spotify call', 'youtube call', 'external api']],
    ['🔄', 'sync', ['sync in progress', 'refresh triggered']],
    ['📋', 'playlist', ['playlist loaded']],
    ['🎬', 'video', ['video replaced', 'track linked']],
    ['🔍', 'search', ['search results', 'found matches']],
    ['💾', 'cache', ['cache hit', 'storage full']],
    ['⚡', 'performance', ['performance report', 'completed in 5s', 'took 300ms']],
    ['🎫', 'session', ['session expired']],
    ['🌐', 'http', ['http error', 'request received', 'response sent']],
    ['📊', 'api', ['api limit', 'quota exceeded']],
    ['✅', 'success', ['success', 'validated ok', 'created ok']],
  ])('starts a line with %s for a %s message', (emoji, _label, messages) => {
    for (const message of messages) {
      expect(emojiFor(message), `"${message}"`).toBe(emoji);
    }
  });

  /**
   * The chain is ordered and the first match wins, which is not what the wording suggests: a
   * message about a sync that has "started" in it is a server message, and creating a playlist is
   * a playlist message rather than a success. Pinned as what it does, not as what it should do -
   * every one of these was written the other way round first, and the code was right.
   */
  it.each([
    ['sync started', '🚀', 'started beats sync'],
    ['found videos', '🎬', 'video beats found'],
    ['created playlist', '📋', 'playlist beats created'],
    ['server request', '🚀', 'server beats request'],
    ['spotify token', '🔐', 'auth beats external'],
  ])('%s gets %s (%s)', (message, emoji) => {
    expect(emojiFor(message)).toBe(emoji);
  });

  it('matches whatever the casing', () => {
    expect(emojiFor('TOKEN refreshed')).toBe('🔐');
  });

  // Nothing in the text to go on, so the context is asked next.
  it.each([
    ['🎫', { sessionId: 's1' }],
    ['🎫', { sessionID: 's1' }],
    ['📋', { playlistId: 'p1' }],
    ['📋', { playlistName: 'mine' }],
    ['🎬', { videoId: 'v1' }],
    ['🎬', { trackId: 't1' }],
    ['📊', { quotaUsed: 50 }],
    ['📊', { apiCalls: 3 }],
  ])('falls back to %s when only the context says so', (emoji, context) => {
    expect(emojiFor('nothing to go on', context)).toBe(emoji);
  });

  // Neither the text nor the context says anything: the level is the last word.
  it.each([
    ['🔍', 'debug' as const, Logger.debug],
    ['ℹ️', 'log' as const, Logger.info],
    ['⚠️', 'warn' as const, Logger.warn],
    ['❌', 'error' as const, Logger.error],
  ])('falls back to %s, the level, when nothing else matches', (emoji, consoleMethod, write) => {
    const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => undefined);

    write('nothing to go on');

    expect(String(spy.mock.calls.at(-1)?.[0]).split(' ')[0]).toBe(emoji);
  });

  // The message is asked before the context, so a playlist id does not override "auth".
  it('lets the message win over the context', () => {
    expect(emojiFor('token refreshed', { playlistId: 'p1' })).toBe('🔐');
  });
});

/**
 * The line's shape: the timestamp it opens with and the context it closes with. Every log line
 * carries a formatTimestamp() prefix and a formatContext() suffix, and neither was ever read.
 */
describe('the shape of a log line', () => {
  const lastLog = () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    return () => String(spy.mock.calls.at(-1)?.[0] ?? '');
  };

  beforeEach(() => Logger.setLevel(LogLevel.DEBUG));
  afterEach(() => vi.useRealTimers());

  it('stamps an ISO-8601 local timestamp with a timezone offset', () => {
    const read = lastLog();

    Logger.info('anything');

    // [YYYY-MM-DDTHH:MM:SS.mmm(+|-)HH:MM] - every field zero-padded to its width.
    expect(read()).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}\]/);
  });

  it('stamps the real calendar date, month 1-based and each part zero-padded', () => {
    vi.useFakeTimers();
    // Noon UTC on a single-digit day -> June 5 in any timezone, and the day must render "05" not "5".
    vi.setSystemTime(new Date(Date.UTC(2024, 5, 5, 12, 0, 0)));
    const read = lastLog();

    Logger.info('anything');

    expect(read()).toContain('2024-06-05T');
  });

  it('appends the context only when there is some, and adds no trailing space when there is none', () => {
    const read = lastLog();

    Logger.info('no context here');
    expect(read()).not.toContain(' | ');
    expect(read()).not.toMatch(/ $/); // formatContext returns '', not ' '

    Logger.info('with context', { playlistId: 'p1' });
    expect(read()).toContain(' | {"playlistId":"p1"}');
  });
});

/**
 * The pieces of the public API nothing called: the specialized helpers, and the error detail that
 * warn/error print alongside the line.
 */
describe('the specialized log helpers', () => {
  const consoleSpies = () => ({
    debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  });

  beforeEach(() => Logger.setLevel(LogLevel.DEBUG));

  it('logs a request at INFO', () => {
    const c = consoleSpies();

    Logger.httpRequest('POST', '/api/thing');

    expect(c.log).toHaveBeenCalled();
    expect(String(c.log.mock.calls.at(-1)?.[0])).toContain('HTTP Request: POST /api/thing');
  });

  it('logs an API operation at INFO', () => {
    const c = consoleSpies();

    Logger.apiOperation('reorder playlist');

    expect(String(c.log.mock.calls.at(-1)?.[0])).toContain('API Operation: reorder playlist');
  });

  it('logs a performance entry with the duration', () => {
    const c = consoleSpies();

    Logger.performance('sync', 4200);

    expect(String(c.log.mock.calls.at(-1)?.[0])).toContain('Performance: sync completed in 4200ms');
  });

  it('logs an HTTP response at ERROR when the status is >= 400', () => {
    const c = consoleSpies();

    Logger.httpResponse('GET', '/x', 404);

    expect(c.error).toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
    expect(String(c.error.mock.calls.at(-1)?.[0])).toContain('HTTP Response: GET /x - 404');
  });

  // The threshold is inclusive: 400 itself is an error, not an info line.
  it('treats status exactly 400 as an error', () => {
    const c = consoleSpies();

    Logger.httpResponse('GET', '/x', 400);

    expect(c.error).toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
  });

  it('logs an HTTP response at INFO for a success, with the duration when given', () => {
    const c = consoleSpies();

    Logger.httpResponse('GET', '/x', 200, 50);

    expect(c.log).toHaveBeenCalled();
    expect(c.error).not.toHaveBeenCalled();
    expect(String(c.log.mock.calls.at(-1)?.[0])).toContain('(50ms)');
  });

  it('omits the duration when none is given', () => {
    const c = consoleSpies();

    Logger.httpResponse('GET', '/x', 200);

    expect(String(c.log.mock.calls.at(-1)?.[0])).toContain('- 200');
    expect(String(c.log.mock.calls.at(-1)?.[0])).not.toContain('ms)');
  });

  it('uppercases the operation in a request-start banner', () => {
    const c = consoleSpies();

    Logger.requestStart('sync playlist');

    expect(String(c.log.mock.calls.at(-1)?.[0])).toContain('=== SYNC PLAYLIST START ===');
  });

  it('closes a request block with the duration', () => {
    const c = consoleSpies();

    Logger.requestEnd('sync playlist', 1234);

    expect(String(c.log.mock.calls.at(-1)?.[0])).toContain('=== SYNC PLAYLIST END (1234ms) ===');
  });

  it('folds the session id into the context', () => {
    const c = consoleSpies();

    Logger.session('opened', 'sess-123');

    const line = String(c.debug.mock.calls.at(-1)?.[0]);
    expect(line).toContain('Session: opened');
    expect(line).toContain('sess-123');
  });

  it('logs external calls at DEBUG', () => {
    const c = consoleSpies();

    Logger.external('Spotify', 'fetching playlist');

    expect(c.debug).toHaveBeenCalled();
    expect(String(c.debug.mock.calls.at(-1)?.[0])).toContain(
      'External: Spotify - fetching playlist',
    );
  });

  it('prints the error object alongside a warning', () => {
    const c = consoleSpies();
    const boom = new Error('boom');

    Logger.warn('something off', {}, boom);

    expect(c.warn).toHaveBeenCalledWith('❌ Error details:', boom);
  });

  it('prints the error object alongside an error', () => {
    const c = consoleSpies();
    const boom = new Error('boom');

    Logger.error('something broke', {}, boom);

    expect(c.error).toHaveBeenCalledWith('❌ Error details:', boom);
  });
});
