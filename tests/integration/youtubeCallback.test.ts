/**
 * Tests for the YouTube OAuth callback's success path.
 *
 * This is the only place that knows a connect just happened. It says so with ?connected=youtube,
 * which is the client's cue to refetch the playlist list past the cache - the copy the browser
 * holds was fetched before the connect and shows every playlist as unsynced.
 *
 * The channel id is read here and cached in the cookie so that later requests do not have to spend
 * a quota unit rediscovering it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const h = vi.hoisted(() => ({ exchangeYoutubeCode: vi.fn(), channelsList: vi.fn() }));

vi.mock('@/youtube/client', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/client')>()),
  exchangeYoutubeCode: h.exchangeYoutubeCode,
  createYoutubeClient: () => ({ channels: { list: h.channelsList } }),
}));

import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';
import { findSetCookie } from '@tests/helpers/httpCookies';

const app = testServer(createApp());

const CODE = 'a'.repeat(40);
const STATE = 'matching-state';

const callback = () =>
  request(app)
    .get('/auth/youtube/callback')
    .set('Cookie', `youtube_oauth_state=${STATE}`)
    .query({ code: CODE, state: STATE });

beforeEach(() => {
  vi.clearAllMocks();
  h.exchangeYoutubeCode.mockResolvedValue({
    access_token: 'yt-access',
    refresh_token: 'yt-refresh',
    scope: 'https://www.googleapis.com/auth/youtube',
    token_type: 'Bearer',
    expiry_date: Date.now() + 3600_000,
  });
  h.channelsList.mockResolvedValue({ data: { items: [{ id: 'UC-channel-id' }] } });
});

describe('a successful YouTube connect', () => {
  it('marks the redirect as a fresh connect', async () => {
    const response = await callback();

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/?connected=youtube');
  });

  it('stores the tokens in a cookie', async () => {
    const response = await callback();

    const cookie = findSetCookie(response, 'youtube_tokens');
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
  });

  it('caches the channel id in the cookie', async () => {
    const response = await callback();

    const cookie = findSetCookie(response, 'youtube_tokens')!;
    const value = JSON.parse(decodeURIComponent(cookie.split(';')[0]!.split('=')[1]!));
    expect(value.channel_id).toBe('UC-channel-id');
    expect(value.access_token).toBe('yt-access');
  });

  it('exchanges the code it was given', async () => {
    await callback();

    expect(h.exchangeYoutubeCode).toHaveBeenCalledWith(CODE);
  });

  it('asks only for the channel id, one channel', async () => {
    await callback();

    expect(h.channelsList).toHaveBeenCalledWith({ part: ['id'], mine: true, maxResults: 1 });
  });
});

describe('when the connect fails', () => {
  it('does not mark a connect when the code exchange fails', async () => {
    h.exchangeYoutubeCode.mockRejectedValue(new Error('invalid_grant'));

    const response = await callback();

    expect(response.headers['location']).toMatch(/^\/\?error=youtube/);
    expect(response.headers['location']).not.toContain('connected=youtube');
  });

  // 400 and 401 are the two YouTube answers that mean "this code or token is no good" - the user
  // can fix that by connecting again, which is what auth_error tells the page to offer.
  it.each([[400], [401]])('reports an auth error for a %i', async (code) => {
    const { YoutubeApiError } = await import('@/youtube/client');
    h.exchangeYoutubeCode.mockRejectedValue(new YoutubeApiError('bad code', code));

    const response = await callback();

    expect(response.headers['location']).toBe('/?error=youtube&reason=auth_error');
  });

  /**
   * A bare 403 is not quota. During OAuth it is far more likely to be a permissions or consent
   * problem, and calling it quota sends the user off to wait for a midnight reset that will never
   * fix it. Not every YoutubeApiError is an auth error either - only the codes that say so.
   */
  it.each([[403], [500]])('reports a plain failure for a %i', async (code) => {
    const { YoutubeApiError } = await import('@/youtube/client');
    h.exchangeYoutubeCode.mockRejectedValue(new YoutubeApiError('nope', code));

    const response = await callback();

    expect(response.headers['location']).toBe('/?error=youtube&reason=failed');
  });

  // An error that is not YouTube's at all cannot be classified by its code.
  it('reports a plain failure for an error with no status at all', async () => {
    h.exchangeYoutubeCode.mockRejectedValue(new Error('socket hang up'));

    const response = await callback();

    expect(response.headers['location']).toBe('/?error=youtube&reason=failed');
  });

  it('reports quota when YouTube says the budget is gone', async () => {
    const { YoutubeApiError } = await import('@/youtube/client');
    h.channelsList.mockRejectedValue(new YoutubeApiError('quota', 403, 'quotaExceeded'));

    const response = await callback();

    expect(response.headers['location']).toBe('/?error=youtube&reason=quota_exceeded');
  });

  // Without a channel id the app cannot tell which account it is talking to, so a connect that
  // cannot produce one is not a connect. Each of these is a shape YouTube can actually return, and
  // none of them may throw on the way to saying so.
  it.each([
    ['an empty channel list', { data: { items: [] } }],
    ['no items key at all', { data: {} }],
    ['a channel with no id', { data: { items: [{}] } }],
  ])('refuses the connect on %s', async (_label, response) => {
    h.channelsList.mockResolvedValue(response);

    const result = await callback();

    expect(result.headers['location']).toBe('/?error=youtube&reason=failed');
    expect(findSetCookie(result, 'youtube_tokens')).toBeUndefined();
  });

  it('stores nothing when the exchange fails', async () => {
    h.exchangeYoutubeCode.mockRejectedValue(new Error('invalid_grant'));

    const response = await callback();

    expect(findSetCookie(response, 'youtube_tokens')).toBeUndefined();
  });
});
