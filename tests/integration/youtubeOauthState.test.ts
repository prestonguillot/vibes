/**
 * The YouTube OAuth flow must carry a `state` value and verify it in the callback.
 *
 * Without it, an attacker can trick a victim's browser into completing the connect with the
 * ATTACKER's authorization code, binding the attacker's YouTube channel to the victim's session
 * (login-CSRF / account fixation). Spotify had this protection; YouTube did not.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();
const CODE = '4/0AXEQxICtest-authorization-code';

beforeEach(() => {
  process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
  process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';
  process.env.YOUTUBE_REDIRECT_URI = 'http://127.0.0.1:3000/auth/youtube/callback';
});

describe('GET /auth/youtube/login - OAuth state', () => {
  it('sets a non-empty youtube_oauth_state cookie with SameSite=Lax', async () => {
    const response = await request(app).get('/auth/youtube/login').expect(302);

    const stateCookie = ([] as string[])
      .concat(response.headers['set-cookie'])
      .find((c) => c.startsWith('youtube_oauth_state='));

    expect(stateCookie).toBeDefined();
    expect(stateCookie).not.toMatch(/^youtube_oauth_state=;/);
    // Lax (not Strict): the callback is a cross-site top-level navigation back from Google, and
    // Strict would withhold the cookie there, failing verification every time.
    expect(stateCookie).toMatch(/SameSite=Lax/i);
  });

  it('passes the same state to Google in the authorize URL', async () => {
    const response = await request(app).get('/auth/youtube/login').expect(302);

    const stateCookie = ([] as string[])
      .concat(response.headers['set-cookie'])
      .find((c) => c.startsWith('youtube_oauth_state='))!;
    const cookieValue = decodeURIComponent(stateCookie.split(';')[0]!.split('=')[1]!);

    const authorizeUrl = new URL(response.headers['location']!);
    expect(authorizeUrl.searchParams.get('state')).toBe(cookieValue);
  });
});

describe('GET /auth/youtube/callback - OAuth state verification', () => {
  it("rejects a callback whose state does not match the cookie (attacker's code is not exchanged)", async () => {
    const response = await request(app)
      .get('/auth/youtube/callback')
      .set('Cookie', 'youtube_oauth_state=expected-state')
      .query({ code: CODE, state: 'attacker-supplied-state' });

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/?error=youtube&reason=state_mismatch');
    // The rejection must happen before any token exchange - no tokens may be set.
    const setCookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    expect(setCookie.some((c) => c.startsWith('youtube_tokens='))).toBe(false);
  });

  it('rejects a callback when the state cookie is missing entirely', async () => {
    const response = await request(app)
      .get('/auth/youtube/callback')
      .query({ code: CODE, state: 'some-state' });

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/?error=youtube&reason=state_mismatch');
  });

  it('rejects a callback with no state param at all', async () => {
    const response = await request(app)
      .get('/auth/youtube/callback')
      .set('Cookie', 'youtube_oauth_state=expected-state')
      .query({ code: CODE });

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/?error=youtube&reason=state_mismatch');
  });

  it('clears the one-time state cookie even when verification fails', async () => {
    const response = await request(app)
      .get('/auth/youtube/callback')
      .set('Cookie', 'youtube_oauth_state=expected-state')
      .query({ code: CODE, state: 'wrong' });

    const setCookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    expect(setCookie.some((c) => /^youtube_oauth_state=;/.test(c))).toBe(true);
  });

  it('gets past the state check when the state matches (then fails at the code exchange)', async () => {
    // Matching state -> verification passes and the route proceeds to exchange the code, which
    // fails against the real Google endpoint, redirecting home with a non-state_mismatch reason.
    const response = await request(app)
      .get('/auth/youtube/callback')
      .set('Cookie', 'youtube_oauth_state=matching-state')
      .query({ code: CODE, state: 'matching-state' });

    expect(response.status).toBe(302);
    expect(response.headers['location']).toMatch(/^\/\?error=youtube&reason=/);
    expect(response.headers['location']).not.toBe('/?error=youtube&reason=state_mismatch');
  });
});
