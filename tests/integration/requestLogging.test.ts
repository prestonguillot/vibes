/**
 * Tests for the request logging middleware in createApp.
 *
 * The logger is silent under test, so these spy on Logger rather than read output: a spy records
 * the call whatever the level does with it afterwards.
 *
 * Nothing asserted this code before, which had a cost beyond the untested lines. Its mutants were
 * "killed" only by whichever unrelated test happened to fall over when they were applied - a CSP
 * string by an OAuth cookie test, the response log line by an album-art test - so the file's score
 * measured coincidence, and disagreed between machines because coincidence does.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import request from 'supertest';

// The status buttons hold their response back so the spinner cannot flash. Nothing here is about
// that wait, and serving it really would cost half a second per status request.
vi.mock('@/lib/delay', () => ({ sleep: vi.fn(() => Promise.resolve()) }));

import { Logger } from '@/lib/logger';
import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';

const app = testServer(createApp());

const SPOTIFY_COOKIE = 'spotify_tokens={"accessToken":"sp","refreshToken":"sp-r"}';
const YOUTUBE_COOKIE = 'youtube_tokens={"access_token":"yt","refresh_token":"yt-r"}';

let requestStart: MockInstance<typeof Logger.requestStart>;
let debug: MockInstance<typeof Logger.debug>;

/** The context of the last requestStart call. */
const startContext = () => requestStart.mock.calls.at(-1)?.[1];
const debugMessages = () => debug.mock.calls.map(([message]) => message);

beforeEach(() => {
  requestStart = vi.spyOn(Logger, 'requestStart');
  debug = vi.spyOn(Logger, 'debug');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request logging: what it records', () => {
  it('logs the method and url of a request', async () => {
    await request(app).get('/health');

    expect(requestStart).toHaveBeenCalledWith('GET /health', expect.anything());
  });

  it('records the full url, not just the path', async () => {
    await request(app).get('/health');

    expect(startContext()!.fullUrl).toMatch(/^http:\/\/[^/]+\/health$/);
  });

  it('keeps the query string in the logged url', async () => {
    await request(app).get('/health?a=1');

    expect(requestStart).toHaveBeenCalledWith('GET /health?a=1', expect.anything());
  });

  it('records the user agent', async () => {
    await request(app).get('/health').set('User-Agent', 'vibes-test-agent');

    expect(startContext()!.userAgent).toBe('vibes-test-agent');
  });

  // A user agent is attacker-controlled and unbounded; it is truncated so one request cannot
  // flood the log.
  it('truncates a very long user agent to 100 characters', async () => {
    await request(app).get('/health').set('User-Agent', 'x'.repeat(500));

    expect(startContext()!.userAgent).toBe('x'.repeat(100));
  });

  it('says none when there is no user agent', async () => {
    await request(app).get('/health').unset('User-Agent');

    expect(startContext()!.userAgent).toBe('none');
  });
});

describe('request logging: whether the caller is authenticated', () => {
  it.each([
    { label: 'neither cookie', cookies: [], expected: false },
    { label: 'a spotify cookie', cookies: [SPOTIFY_COOKIE], expected: true },
    { label: 'a youtube cookie', cookies: [YOUTUBE_COOKIE], expected: true },
    { label: 'both cookies', cookies: [SPOTIFY_COOKIE, YOUTUBE_COOKIE], expected: true },
  ])('reports hasAuth $expected for $label', async ({ cookies, expected }) => {
    await request(app).get('/health').set('Cookie', cookies);

    expect(startContext()!.hasAuth).toBe(expected);
  });
});

describe('request logging: static assets are skipped', () => {
  // Every page load pulls these; logging them buries the requests worth reading.
  it.each([['/a.css'], ['/a.js'], ['/a.png'], ['/a.ico'], ['/favicon'], ['/favicon.ico']])(
    'logs nothing for %s',
    async (url) => {
      await request(app).get(url);

      expect(requestStart).not.toHaveBeenCalled();
    },
  );

  it.each([['/health'], ['/api/status/spotify/button']])('still logs %s', async (url) => {
    await request(app).get(url);

    expect(requestStart).toHaveBeenCalled();
  });

  // The check is a substring match on the whole url, so a path that merely contains one of the
  // extensions is skipped too. Pinned as the behaviour it is, not endorsed.
  it('skips a route whose query string happens to contain .css', async () => {
    await request(app).get('/health?redirect=/x.css');

    expect(requestStart).not.toHaveBeenCalled();
  });
});

describe('request logging: query parameters', () => {
  it('logs them when there are some', async () => {
    await request(app).get('/health?colour=red&size=2');

    expect(debug).toHaveBeenCalledWith('Request query parameters', {
      query: { colour: 'red', size: '2' },
    });
  });

  it('says nothing when there are none', async () => {
    await request(app).get('/health');

    expect(debugMessages()).not.toContain('Request query parameters');
  });
});

describe('request logging: the request body', () => {
  it('logs a json body', async () => {
    await request(app).post('/no-such-route').send({ hello: 'world' });

    expect(debug).toHaveBeenCalledWith('Request body', { body: { hello: 'world' } });
  });

  // Express 5 leaves req.body undefined when no parser matched, so an unguarded read throws.
  it('says nothing for a GET, which has no body at all', async () => {
    await request(app).get('/health');

    expect(debugMessages()).not.toContain('Request body');
  });

  it('says nothing for an empty body', async () => {
    await request(app).post('/no-such-route').send({});

    expect(debugMessages()).not.toContain('Request body');
  });
});

describe('request logging: the response', () => {
  // res.on('finish') fires after the handler returns, so this waits for it rather than assuming
  // it has already run by the time supertest resolves.
  it('logs the status code once the response is sent', async () => {
    await request(app).get('/health');

    await vi.waitFor(() =>
      expect(debug).toHaveBeenCalledWith('Response sent', {
        statusCode: 200,
        statusMessage: expect.anything(),
      }),
    );
  });

  it('logs the status code of a failed request too', async () => {
    await request(app).get('/no-such-route');

    await vi.waitFor(() =>
      expect(debug).toHaveBeenCalledWith(
        'Response sent',
        expect.objectContaining({ statusCode: 404 }),
      ),
    );
  });
});

/**
 * The policy is built while createApp() runs, so these call it inside the test rather than share
 * the app above. A module-scope createApp() has already run by the time any test starts, which
 * leaves the directives below attributed to no test at all - they read as covered while nothing
 * is pinning them.
 */
describe('the content security policy', () => {
  const csp = async () => {
    const response = await request(createApp()).get('/health');
    return response.headers['content-security-policy'];
  };

  // Self-hosted vendor scripts and fonts are the point of the policy: no external origin should
  // appear in it. Inline is allowed because the templates use inline handlers and styles.
  it.each([
    ['script-src', "script-src 'self' 'unsafe-inline'"],
    ['style-src', "style-src 'self' 'unsafe-inline'"],
    ['connect-src', "connect-src 'self'"],
  ])('allows only self and inline for %s', async (_label, directive) => {
    expect(await csp()).toContain(directive);
  });

  it('allows images from anywhere, for YouTube thumbnails', async () => {
    expect(await csp()).toContain("img-src 'self' data: https: http:");
  });

  it('names no external origin', async () => {
    expect(await csp()).not.toMatch(/https:\/\/[a-z]/);
  });
});
