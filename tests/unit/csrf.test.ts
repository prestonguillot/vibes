/**
 * Tests for src/auth/csrf.ts - the signed double-submit cookie.
 *
 * The six 403 paths each carry a different message, which is the only way to tell them apart in a
 * log. One of them is reachable in a way that is easy to miss - see the timingSafeEqual note.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  csrfCookieMiddleware,
  csrfValidationMiddleware,
  generateCsrfToken,
  getCsrfToken,
  logSafePrefix,
} from '../../src/auth/csrf';
import { fakeRequest, fakeResponse } from '../helpers/expressStubs';
import { Logger } from '../../src/lib/logger';

// A fixed secret keeps signatures deterministic; the real one is a lazily generated singleton.
vi.mock('../../src/auth/csrfSecret', () => ({ getCsrfSecret: () => 'test-csrf-secret' }));

const next = () => vi.fn();

/** A valid signed cookie, produced by the middleware itself rather than re-implemented here. */
function issueToken(): { signed: string; token: string } {
  const res = fakeResponse();
  csrfCookieMiddleware(fakeRequest({ cookies: {} }), res.res, next());
  const signed = res.cookies()[0]!.value;
  return { signed, token: signed.split('.')[0]! };
}

beforeEach(() => vi.restoreAllMocks());

describe('generateCsrfToken', () => {
  it('is 32 bytes of hex', () => {
    expect(generateCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is different every time', () => {
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});

// Every diagnostic in the middleware prints token/signature fragments through this one helper, so
// the "never log a whole secret" property lives here rather than being re-checked at each log site.
describe('logSafePrefix', () => {
  it('keeps only the first 8 characters and marks the truncation', () => {
    expect(logSafePrefix('abcdefghijklmnop')).toBe('abcdefgh...');
  });

  it('never returns the whole secret', () => {
    const secret = generateCsrfToken(); // 64 hex chars

    const printed = logSafePrefix(secret);

    expect(printed).toBe(secret.substring(0, 8) + '...');
    expect(printed).not.toContain(secret);
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
  ])('reports an absent value (%s) as NONE', (_label, value) => {
    expect(logSafePrefix(value)).toBe('NONE');
  });
});

describe('csrfCookieMiddleware', () => {
  it('issues a signed token.signature cookie when there is none', () => {
    const res = fakeResponse();
    const nextFn = next();

    csrfCookieMiddleware(fakeRequest({ cookies: {} }), res.res, nextFn);

    const cookie = res.cookies()[0]!;
    expect(cookie.name).toBe('csrf_token');
    expect(cookie.value).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}$/);
    expect(nextFn).toHaveBeenCalled();
  });

  it('sets the cookie options that make the pattern work', () => {
    const res = fakeResponse();

    csrfCookieMiddleware(fakeRequest({ cookies: {} }), res.res, next());

    // Asserted whole: httpOnly stops JS reading it, sameSite:strict is half the CSRF defence,
    // and a wrong maxAge silently logs people out.
    expect(res.cookies()[0]!.options).toEqual({
      httpOnly: true,
      secure: false, // NODE_ENV is 'test' here
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });
  });

  it('marks the cookie secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = fakeResponse();

    csrfCookieMiddleware(fakeRequest({ cookies: {} }), res.res, next());

    expect(res.cookies()[0]!.options.secure).toBe(true);
    vi.unstubAllEnvs();
  });

  it('exposes the UNSIGNED token on res.locals for templates', () => {
    const res = fakeResponse();

    csrfCookieMiddleware(fakeRequest({ cookies: {} }), res.res, next());

    const signed = res.cookies()[0]!.value;
    expect(res.locals.csrfToken).toBe(signed.split('.')[0]);
    expect(res.locals.csrfToken).not.toContain('.');
  });

  it('reuses an existing cookie instead of reissuing', () => {
    const { signed, token } = issueToken();
    const res = fakeResponse();

    csrfCookieMiddleware(fakeRequest({ cookies: { csrf_token: signed } }), res.res, next());

    expect(res.cookies()).toHaveLength(0);
    expect(res.locals.csrfToken).toBe(token);
  });

  it('always continues the chain', () => {
    const nextFn = next();

    csrfCookieMiddleware(fakeRequest({ cookies: {} }), fakeResponse().res, nextFn);

    expect(nextFn).toHaveBeenCalledOnce();
  });
});

describe('csrfValidationMiddleware', () => {
  const validate = (cookies: Record<string, string>, headers: Record<string, string>) => {
    const res = fakeResponse();
    const nextFn = next();
    csrfValidationMiddleware(fakeRequest({ cookies, headers }), res.res, nextFn);
    return { res, nextFn };
  };

  it('passes a request whose header token matches its signed cookie', () => {
    const { signed, token } = issueToken();

    const { res, nextFn } = validate({ csrf_token: signed }, { 'x-csrf-token': token });

    expect(nextFn).toHaveBeenCalled();
    expect(res.statusCode()).toBeUndefined();
  });

  // Six 403 paths, each with its own message. The messages are the only way to tell them apart in
  // a log, so they are asserted rather than just the status.
  it('rejects a request with no header token', () => {
    const { signed } = issueToken();

    const { res, nextFn } = validate({ csrf_token: signed }, {});

    expect(res.statusCode()).toBe(403);
    expect(res.body()).toEqual({ error: 'CSRF token missing in request header' });
    expect(nextFn).not.toHaveBeenCalled();
  });

  it('rejects a request with no cookie', () => {
    const { res, nextFn } = validate({}, { 'x-csrf-token': 'anything' });

    expect(res.statusCode()).toBe(403);
    expect(res.body()).toEqual({ error: 'CSRF token missing in cookie' });
    expect(nextFn).not.toHaveBeenCalled();
  });

  it.each([
    ['no signature', 'justatoken'],
    ['no token', '.justasignature'],
  ])('rejects a malformed cookie (%s)', (_label, cookie) => {
    const { res } = validate({ csrf_token: cookie }, { 'x-csrf-token': 'justatoken' });

    expect(res.statusCode()).toBe(403);
    expect(res.body()).toEqual({ error: 'Invalid CSRF token format' });
  });

  it('rejects a forged signature of the right length', () => {
    const { token } = issueToken();
    const forged = 'f'.repeat(64); // same length as a real HMAC-SHA256 hex digest

    const { res, nextFn } = validate(
      { csrf_token: `${token}.${forged}` },
      { 'x-csrf-token': token },
    );

    expect(res.statusCode()).toBe(403);
    expect(res.body()).toEqual({ error: 'Invalid CSRF token signature' });
    expect(nextFn).not.toHaveBeenCalled();
  });

  // crypto.timingSafeEqual THROWS when the buffers differ in length - it does not return false. So
  // a wrong-LENGTH signature lands in the catch and reports 'validation error', not 'invalid
  // signature'. Testing only the same-length forgery above would never reach this branch.
  it('rejects a signature of the wrong length via the error path, not the mismatch path', () => {
    const { token } = issueToken();

    const { res, nextFn } = validate(
      { csrf_token: `${token}.tooshort` },
      { 'x-csrf-token': token },
    );

    expect(res.statusCode()).toBe(403);
    expect(res.body()).toEqual({ error: 'CSRF token validation error' });
    expect(nextFn).not.toHaveBeenCalled();
  });

  // The double-submit itself: a correctly signed cookie is not enough if the header disagrees.
  it('rejects when the header token does not match the cookie token', () => {
    const { signed } = issueToken();
    const other = issueToken();

    const { res, nextFn } = validate({ csrf_token: signed }, { 'x-csrf-token': other.token });

    expect(res.statusCode()).toBe(403);
    expect(res.body()).toEqual({ error: 'CSRF token mismatch' });
    expect(nextFn).not.toHaveBeenCalled();
  });
});

describe('getCsrfToken', () => {
  it('prefers res.locals, which the cookie middleware sets', () => {
    const res = fakeResponse();
    res.locals.csrfToken = 'from-locals';

    expect(getCsrfToken(fakeRequest({ cookies: { csrf_token: 'other.sig' } }), res.res)).toBe(
      'from-locals',
    );
  });

  it('falls back to the cookie when the middleware has not run', () => {
    const { signed, token } = issueToken();

    expect(getCsrfToken(fakeRequest({ cookies: { csrf_token: signed } }), fakeResponse().res)).toBe(
      token,
    );
  });

  it('returns null when there is no cookie at all', () => {
    expect(getCsrfToken(fakeRequest({ cookies: {} }), fakeResponse().res)).toBeNull();
  });

  it('returns null when the cookie has an empty token part', () => {
    expect(
      getCsrfToken(fakeRequest({ cookies: { csrf_token: '.signature' } }), fakeResponse().res),
    ).toBeNull();
  });
});

/**
 * What a 403 leaves behind.
 *
 * A rejected request tells the user nothing useful - by design, it is a forgery response. The log is
 * the only way to tell which of the six failures happened and why, and it is what gets read when a
 * real user is locked out of a button. It ran on every test above and nothing ever looked at it.
 */
describe('csrfValidationMiddleware: what it reports', () => {
  const warnings = () => vi.mocked(Logger.warn).mock.calls;
  const lastWarning = () => warnings().at(-1) as [string, Record<string, unknown>] | undefined;

  const validate = (cookies: Record<string, string>, headers: Record<string, string>) => {
    const res = fakeResponse();
    csrfValidationMiddleware(
      fakeRequest({ cookies, headers, method: 'POST', originalUrl: '/api/x' }),
      res.res,
      next(),
    );
    return res;
  };

  beforeEach(() => {
    vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
  });

  const debugCall = (needle: string) =>
    vi.mocked(Logger.debug).mock.calls.find(([m]) => String(m).includes(needle));

  it.each([
    ['missing header token', {}, {}],
    ['missing cookie token', {}, { 'x-csrf-token': 'abc' }],
    ['malformed cookie token', { csrf_token: 'nodot' }, { 'x-csrf-token': 'nodot' }],
  ])('names the failure in the log: %s', (expected, cookies, headers) => {
    validate(cookies, headers);

    expect(lastWarning()?.[0]).toContain(expected);
  });

  // Which request was rejected. Without it a 403 in a log is unattributable.
  it.each([
    ['missing header', {}, {}],
    ['missing cookie', {}, { 'x-csrf-token': 'abc' }],
    ['malformed cookie', { csrf_token: 'nodot' }, { 'x-csrf-token': 'nodot' }],
  ])('says which request it was: %s', (_label, cookies, headers) => {
    validate(cookies, headers);

    expect(lastWarning()?.[1]).toMatchObject({ url: '/api/x', method: 'POST' });
  });

  // Not the token itself: a CSRF token in a log is a CSRF token in a log.
  it('logs a prefix of the tokens, never the whole thing', () => {
    const { signed, token } = issueToken();
    const other = issueToken();
    validate({ csrf_token: signed }, { 'x-csrf-token': other.token });

    const printed = JSON.stringify(vi.mocked(Logger.debug).mock.calls);
    expect(printed).toContain(token.substring(0, 8));
    expect(printed).not.toContain(token);
  });

  it('says NONE rather than a prefix when a token is simply absent', () => {
    validate({}, {});

    const printed = JSON.stringify(vi.mocked(Logger.debug).mock.calls);
    expect(printed).toContain('NONE');
  });

  // A mismatch and a forgery are different problems: one is a stale tab, the other is an attack.
  it('reports whether the two tokens even matched', () => {
    const { signed, token } = issueToken();
    validate({ csrf_token: signed }, { 'x-csrf-token': token });

    const components = vi
      .mocked(Logger.debug)
      .mock.calls.find(([m]) => String(m).includes('components'));
    expect(components?.[1]).toMatchObject({ tokensMatch: true });
  });

  it('reports a mismatch as a mismatch', () => {
    const { signed } = issueToken();
    const other = issueToken();
    validate({ csrf_token: signed }, { 'x-csrf-token': other.token });

    const components = vi
      .mocked(Logger.debug)
      .mock.calls.find(([m]) => String(m).includes('components'));
    expect(components?.[1]).toMatchObject({ tokensMatch: false });
  });

  // The header name is the first thing to check when a client stops sending it. Only the csrf-ish
  // headers are listed - not every header on the request, which would be noise (and could itself
  // leak something). The content-type below must not appear.
  it('lists only the csrf headers that WERE sent when the expected one was not', () => {
    const res = fakeResponse();
    csrfValidationMiddleware(
      fakeRequest({
        cookies: {},
        headers: { 'x-csrf-tokn': 'typo', 'content-type': 'application/json' },
        method: 'POST',
        originalUrl: '/api/x',
      }),
      res.res,
      next(),
    );

    expect(lastWarning()?.[1]).toMatchObject({ headers: ['x-csrf-tokn'] });
  });

  it('reports which half of a malformed cookie was missing', () => {
    validate(
      { csrf_token: 'token-with-no-signature.' },
      { 'x-csrf-token': 'token-with-no-signature' },
    );

    expect(lastWarning()?.[1]).toMatchObject({ hasCookieToken: true, hasSignature: false });
  });

  // The opening debug line records which of the two tokens even arrived - the first thing to look at.
  it('records which of the header and cookie tokens were present', () => {
    validate({}, { 'x-csrf-token': 'abc' }); // header present, cookie absent

    const starting = vi
      .mocked(Logger.debug)
      .mock.calls.find(([m]) => String(m).includes('validation starting'));
    expect(starting?.[1]).toMatchObject({ hasHeaderToken: true, hasCookieToken: false });
  });

  // The two attack-shaped rejections must be attributable to a request just like the plain ones.
  it('attributes the invalid-signature rejection to the request', () => {
    const { token } = issueToken();
    validate({ csrf_token: `${token}.${'f'.repeat(64)}` }, { 'x-csrf-token': token });

    expect(lastWarning()?.[0]).toContain('invalid signature');
    expect(lastWarning()?.[1]).toMatchObject({ url: '/api/x', method: 'POST' });
  });

  it('attributes the token-mismatch rejection to the request', () => {
    const { signed } = issueToken();
    const other = issueToken();
    validate({ csrf_token: signed }, { 'x-csrf-token': other.token });

    expect(lastWarning()?.[0]).toContain('token mismatch');
    expect(lastWarning()?.[1]).toMatchObject({ url: '/api/x', method: 'POST' });
  });

  it('records the signature-verification result on the happy path', () => {
    const { signed, token } = issueToken();
    validate({ csrf_token: signed }, { 'x-csrf-token': token });

    expect(debugCall('signature verification')?.[1]).toMatchObject({ signatureValid: true });
  });

  it('attributes the wrong-length validation error to the request', () => {
    const { token } = issueToken();

    validate({ csrf_token: `${token}.tooshort` }, { 'x-csrf-token': token });

    // The wrong-length signature throws in timingSafeEqual and lands in the catch as an error log.
    expect(vi.mocked(Logger.error)).toHaveBeenCalledWith(
      'CSRF validation error',
      expect.objectContaining({ url: '/api/x', method: 'POST' }),
      expect.anything(),
    );
  });

  it('logs a successful validation against the request', () => {
    const { signed, token } = issueToken();

    validate({ csrf_token: signed }, { 'x-csrf-token': token });

    expect(vi.mocked(Logger.info)).toHaveBeenCalledWith(
      'CSRF validation successful ✓',
      expect.objectContaining({ url: '/api/x', method: 'POST' }),
    );
  });
});

describe('csrfCookieMiddleware: what it reports', () => {
  it('logs the generated token by prefix only, never in full', () => {
    const debugSpy = vi.spyOn(Logger, 'debug').mockImplementation(() => undefined);
    const res = fakeResponse();

    csrfCookieMiddleware(fakeRequest({ cookies: {} }), res.res, next());

    const token = res.cookies()[0]!.value.split('.')[0]!;
    const gen = debugSpy.mock.calls.find(([m]) => String(m).includes('Generated new CSRF token'));
    expect(gen?.[1]).toMatchObject({ tokenPrefix: `${token.substring(0, 8)}...` });
    expect(JSON.stringify(gen)).not.toContain(token);
  });
});
