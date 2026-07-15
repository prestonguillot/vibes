/**
 * Tests for src/auth/csrf.ts - the signed double-submit cookie.
 *
 * Security-relevant and almost entirely unexecuted: 133 mutants, 114 of them never run. The six
 * distinct 403 paths each carry a different message, and one of them is reachable in a way that is
 * easy to miss - see the timingSafeEqual note below.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  csrfCookieMiddleware,
  csrfValidationMiddleware,
  generateCsrfToken,
  getCsrfToken,
} from '../../src/auth/csrf';
import { fakeRequest, fakeResponse } from '../helpers/expressStubs';

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
