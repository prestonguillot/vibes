/**
 * Tests for src/auth/oauthState.ts - the OAuth `state` CSRF defence.
 *
 * Without it an attacker can complete the connect with THEIR authorization code in a victim's
 * browser, binding the attacker's account to the victim's session. Spotify had this check;
 * YouTube did not until #66.
 *
 * 100% line coverage, 42.4% mutation: the integration test asserts SameSite=Lax and nothing else,
 * so every other cookie option was free to change.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { issueOAuthState, verifyOAuthState } from '../../src/auth/oauthState';
import { Logger } from '../../src/lib/logger';
import { fakeRequest, fakeResponse } from '../helpers/expressStubs';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
});

describe('issueOAuthState', () => {
  it('returns the state it stored in the cookie', () => {
    const res = fakeResponse();

    const state = issueOAuthState(res.res, 'spotify_oauth_state');

    expect(res.cookies()[0]!.name).toBe('spotify_oauth_state');
    expect(res.cookies()[0]!.value).toBe(state);
  });

  it('mints a fresh state each time', () => {
    expect(issueOAuthState(fakeResponse().res, 'x')).not.toBe(
      issueOAuthState(fakeResponse().res, 'x'),
    );
  });

  it('sets the cookie options the flow depends on', () => {
    const res = fakeResponse();

    issueOAuthState(res.res, 'spotify_oauth_state');

    // Asserted whole. sameSite MUST be lax, not strict: the callback is a cross-site top-level
    // navigation back from the provider, and strict would withhold the cookie there, failing
    // verification every single time. path:'/' matters because the callback path differs from
    // the login path.
    expect(res.cookies()[0]!.options).toEqual({
      httpOnly: true,
      secure: false, // NODE_ENV is 'test'
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
  });

  it('marks the cookie secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = fakeResponse();

    issueOAuthState(res.res, 'spotify_oauth_state');

    expect(res.cookies()[0]!.options.secure).toBe(true);
    vi.unstubAllEnvs();
  });

  it('uses the cookie name it is given', () => {
    const res = fakeResponse();

    issueOAuthState(res.res, 'youtube_oauth_state');

    expect(res.cookies()[0]!.name).toBe('youtube_oauth_state');
  });
});

describe('verifyOAuthState', () => {
  const verify = (cookieValue: string | undefined, received: string | undefined) => {
    const res = fakeResponse();
    const req = fakeRequest({
      cookies: cookieValue === undefined ? {} : { spotify_oauth_state: cookieValue },
    });
    const ok = verifyOAuthState(req, res.res, 'spotify_oauth_state', received, 'Spotify');
    return { ok, res };
  };

  it('accepts a callback whose state matches the cookie', () => {
    expect(verify('the-state', 'the-state').ok).toBe(true);
  });

  it('rejects a mismatched state', () => {
    expect(verify('the-state', 'a-different-state').ok).toBe(false);
  });

  it('rejects when the callback carries no state', () => {
    expect(verify('the-state', undefined).ok).toBe(false);
  });

  it('rejects when there is no cookie to compare against', () => {
    expect(verify(undefined, 'some-state').ok).toBe(false);
  });

  // Both empty must NOT be treated as a match - that would make the whole check a no-op for any
  // caller that forgot to send a state.
  it('rejects when both sides are empty', () => {
    expect(verify('', '').ok).toBe(false);
  });

  it.each([
    ['a match', 'the-state', 'the-state'],
    ['a mismatch', 'the-state', 'other'],
    ['a missing cookie', undefined, 'other'],
  ])('clears the single-use cookie after %s', (_label, cookieValue, received) => {
    const { res } = verify(cookieValue, received);

    expect(res.res.clearCookie).toHaveBeenCalledWith('spotify_oauth_state', { path: '/' });
  });

  it('says which side was missing when it rejects', () => {
    verify(undefined, 'some-state');

    expect(Logger.warn).toHaveBeenCalledWith('Spotify callback rejected - OAuth state mismatch', {
      hasExpectedState: false,
      hasReceivedState: true,
    });
  });

  it('names the service in the rejection', () => {
    const res = fakeResponse();

    verifyOAuthState(fakeRequest({ cookies: {} }), res.res, 'youtube_oauth_state', 'x', 'YouTube');

    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('YouTube callback rejected'),
      expect.anything(),
    );
  });

  it('does not warn when the state is good', () => {
    verify('the-state', 'the-state');

    expect(Logger.warn).not.toHaveBeenCalled();
  });
});
