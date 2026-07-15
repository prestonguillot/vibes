/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/logger.js - the browser-side logger every other client script calls.
 *
 * Its job is to survive whatever it is handed: a click handler passing a DOM element, an object
 * that references itself, an error mid-serialization. Any of those throwing would take out the
 * caller's code path, which is the opposite of what a logger is for.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface ClientLogger {
  setLevel(level: number): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>, error?: unknown): void;
  error(message: string, context?: Record<string, unknown>, error?: unknown): void;
  apiRequest(method: string, url: string, context?: Record<string, unknown>): void;
  apiResponse(method: string, url: string, status: number, context?: Record<string, unknown>): void;
  userAction(action: string, context?: Record<string, unknown>): void;
  auth(service: string, status: string, context?: Record<string, unknown>): void;
  cache(operation: string, key: string, context?: Record<string, unknown>): void;
  performance(operation: string, duration: number, context?: Record<string, unknown>): void;
  htmx(event: string, details?: Record<string, unknown>): void;
}

declare global {
  interface Window {
    Logger: ClientLogger;
  }
}

const LEVEL = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

type ConsoleMethod = 'debug' | 'log' | 'warn' | 'error';
type ConsoleSpy = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
let spies: Record<ConsoleMethod, ConsoleSpy>;

async function load() {
  vi.resetModules();
  await import('../../public/js/logger.js');
}

/** Everything printed to the given console method, joined. */
const printed = (method: ConsoleMethod) =>
  spies[method].mock.calls.map((args: unknown[]) => args.join(' ')).join('\n');

beforeEach(async () => {
  vi.restoreAllMocks();
  spies = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  };
  await load();
  // The module logs "Client-side logger initialized" as it loads; drop it so each test sees only
  // its own output.
  Object.values(spies).forEach((spy) => spy.mockClear());
});

afterEach(() => vi.useRealTimers());

describe('loading the module', () => {
  it('announces itself, so the console shows the logger is live', async () => {
    Object.values(spies).forEach((spy) => spy.mockClear());

    await load();

    expect(printed('log')).toContain('Client-side logger initialized');
  });
});

describe('level gating', () => {
  it('logs everything at DEBUG', () => {
    window.Logger.setLevel(LEVEL.DEBUG);

    window.Logger.debug('d');
    window.Logger.info('i');
    window.Logger.warn('w');
    window.Logger.error('e');

    expect(spies.debug).toHaveBeenCalled();
    expect(spies.log).toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalled();
  });

  it('suppresses everything below the current level', () => {
    window.Logger.setLevel(LEVEL.WARN);

    window.Logger.debug('d');
    window.Logger.info('i');
    window.Logger.warn('w');

    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalled();
  });

  it('still reports errors at the ERROR level', () => {
    window.Logger.setLevel(LEVEL.ERROR);

    window.Logger.warn('w');
    window.Logger.error('e');

    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalled();
  });
});

describe('the log line', () => {
  beforeEach(() => window.Logger.setLevel(LEVEL.DEBUG));

  it('carries an emoji, an ISO-8601 local timestamp, the level and the message', () => {
    window.Logger.info('Playlist loaded');

    // ISO 8601 with a local offset, not a Z - the timestamp is meant to read in the user's zone.
    expect(printed('log')).toMatch(
      /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}\] \[INFO\] Playlist loaded/,
    );
  });

  it('names the level it was logged at', () => {
    window.Logger.debug('a');
    window.Logger.warn('b');

    expect(printed('debug')).toContain('[DEBUG]');
    expect(printed('warn')).toContain('[WARN]');
  });

  it('appends the context as JSON', () => {
    window.Logger.info('Loaded', { playlistId: 'pl1', count: 2 });

    expect(printed('log')).toContain('{"playlistId":"pl1","count":2}');
  });

  it('appends nothing for an empty context', () => {
    window.Logger.info('Plain');

    expect(printed('log')).not.toContain('|');
  });

  it('passes an error object through to the console, separate from the message', () => {
    const error = new Error('boom');

    window.Logger.error('It failed', {}, error);

    expect(spies.error).toHaveBeenCalledWith('❌ Error details:', error);
  });

  it('omits the error line when there is no error', () => {
    window.Logger.error('It failed');

    expect(spies.error).toHaveBeenCalledTimes(1);
  });
});

describe('formatting a context it cannot serialize', () => {
  beforeEach(() => window.Logger.setLevel(LEVEL.DEBUG));

  // A click handler logging `{ element }` is routine; JSON.stringify would throw on it.
  it('replaces a DOM element rather than throwing', () => {
    document.body.innerHTML = '<button id="b">x</button>';

    window.Logger.info('Clicked', { element: document.getElementById('b') });

    expect(printed('log')).toContain('[DOM Element]');
  });

  it('replaces an Event rather than throwing', () => {
    window.Logger.info('Handled', { event: new MouseEvent('click') });

    expect(printed('log')).toContain('[DOM Element]');
  });

  it('replaces a circular reference rather than throwing', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    expect(() => window.Logger.info('Circular', { circular })).not.toThrow();
    expect(printed('log')).toContain('[Circular Reference]');
  });

  it('reports a value that cannot be serialized at all, and keeps the message', () => {
    const hostile = {
      get boom() {
        throw new Error('cannot read this');
      },
    };

    expect(() => window.Logger.info('Hostile', { hostile })).not.toThrow();
    expect(printed('log')).toContain('could not serialize');
    expect(printed('log')).toContain('Hostile');
  });

  it('does not leak the circular-tracking set between calls', () => {
    const shared = { name: 'shared' };

    window.Logger.info('First', { a: shared, b: shared });
    window.Logger.info('Second', { shared });

    // A second call must not mistake the same object for a circular reference.
    expect(printed('log').split('\n')[1]).toContain('"name":"shared"');
  });
});

describe('choosing an emoji', () => {
  beforeEach(() => window.Logger.setLevel(LEVEL.DEBUG));

  it.each([
    ['User clicked the button', '👤'],
    ['Cache hit for playlist', '💾'],
    ['Starting sync', '🔄'],
    ['Loaded 3 items', '💾'],
    ['playlist rendered', '📋'],
    ['video swapped', '🎬'],
    ['edit the title', '✏️'],
    ['search returned nothing', '🔍'],
    ['sync completed', '🔄'],
    ['connection status changed', '🔗'],
    ['auth token stored', '🔐'],
    ['htmx swap done', '🌐'],
    ['modal opened', '📱'],
  ])('picks one from the message: %s', (message, emoji) => {
    window.Logger.debug(message);

    expect(printed('debug').startsWith(emoji)).toBe(true);
  });

  // The chain is ordered, so an earlier term wins: "user" is checked before "playlist".
  it('takes the first matching term when a message has several', () => {
    window.Logger.debug('user opened playlist');

    expect(printed('debug').startsWith('👤')).toBe(true);
  });

  it.each([
    [{ playlistId: 'pl1' }, '📋'],
    [{ videoId: 'v1' }, '🎬'],
    [{ cached: true }, '💾'],
    [{ buttonId: 'b1' }, '🔘'],
  ])('falls back to the context when the message says nothing: %o', (context, emoji) => {
    window.Logger.debug('nothing notable here', context);

    expect(printed('debug').startsWith(emoji)).toBe(true);
  });

  it.each([
    ['debug', '🔍'],
    ['info', 'ℹ️'],
    ['warn', '⚠️'],
    ['error', '❌'],
  ])('falls back to the level for %s', (method, emoji) => {
    window.Logger[method as 'debug' | 'info' | 'warn' | 'error']('zzz');

    const stream = method === 'info' ? 'log' : (method as 'debug' | 'warn' | 'error');
    expect(printed(stream).startsWith(emoji)).toBe(true);
  });
});

describe('the specialized helpers', () => {
  beforeEach(() => window.Logger.setLevel(LEVEL.DEBUG));

  it('logs an API request', () => {
    window.Logger.apiRequest('GET', '/api/playlists');

    expect(printed('log')).toContain('API Request: GET /api/playlists');
  });

  // A failed response must not be filed as INFO - it is the thing you go looking for.
  it('logs a failing API response at ERROR and a good one at INFO', () => {
    window.Logger.apiResponse('GET', '/api/playlists', 500);
    window.Logger.apiResponse('GET', '/api/playlists', 200);

    expect(printed('error')).toContain('API Response: GET /api/playlists - 500');
    expect(printed('log')).toContain('API Response: GET /api/playlists - 200');
  });

  it.each([[400], [401], [503]])('treats %i as an error', (status) => {
    window.Logger.apiResponse('GET', '/x', status);

    expect(printed('error')).toContain(String(status));
  });

  it.each([
    [() => window.Logger.userAction('clicked sync'), 'log', 'User Action: clicked sync'],
    [() => window.Logger.auth('Spotify', 'connected'), 'log', 'Auth: Spotify - connected'],
    [() => window.Logger.cache('hit', 'pl1'), 'debug', 'Cache: hit - pl1'],
    [() => window.Logger.performance('sync', 1200), 'log', 'Performance: sync completed in 1200ms'],
    [() => window.Logger.htmx('afterSwap'), 'debug', 'HTMX: afterSwap'],
  ])('formats its message', (call, stream, expected) => {
    call();

    expect(printed(stream as 'log' | 'debug')).toContain(expected);
  });
});
