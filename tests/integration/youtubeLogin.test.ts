/**
 * The YouTube login redirect.
 *
 * The scopes are the whole point of it: ask for too few and every later call 403s, ask for more
 * than the app uses and the user is handed a consent screen for permissions nothing needs. Nothing
 * looked at them - `YOUTUBE_SCOPES = []` was a surviving mutant, and until ignoreStatic was turned
 * off it was not even visible as one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const h = vi.hoisted(() => ({ getYoutubeAuthUrl: vi.fn() }));

vi.mock('@/youtube/client', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/client')>()),
  getYoutubeAuthUrl: h.getYoutubeAuthUrl,
}));

import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';
import { findSetCookie } from '@tests/helpers/httpCookies';

const app = testServer(createApp());

const login = () => request(app).get('/auth/youtube/login');

beforeEach(() => {
  vi.clearAllMocks();
  h.getYoutubeAuthUrl.mockReturnValue(
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
  );
});

describe('GET /auth/youtube/login', () => {
  it('asks for exactly the scope the app uses', async () => {
    await login();

    expect(h.getYoutubeAuthUrl).toHaveBeenCalledWith(
      ['https://www.googleapis.com/auth/youtube'],
      expect.any(String),
    );
  });

  it('sends the user to the URL it was given', async () => {
    const response = await login();

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
    );
  });

  /**
   * The state is what the callback checks to know the redirect came from here, so a callback that
   * did not originate from this app is rejected. An empty one fails that check open.
   */
  it('issues a state, and remembers it in a cookie', async () => {
    const response = await login();

    const [, state] = h.getYoutubeAuthUrl.mock.calls.at(-1)!;
    expect(state).toBeTruthy();

    const cookie = findSetCookie(response, 'youtube_oauth_state');
    expect(cookie).toBeDefined();
    expect(cookie).toContain(state as string);
  });

  // Two logins must not be able to share a state, or one tab's callback would satisfy the other's.
  it('issues a fresh state each time', async () => {
    await login();
    await login();

    const states = h.getYoutubeAuthUrl.mock.calls.map(([, state]) => state);
    expect(states).toHaveLength(2);
    expect(states[0]).not.toBe(states[1]);
  });
});
