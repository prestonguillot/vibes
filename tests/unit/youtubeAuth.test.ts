/**
 * Tests for src/youtube/auth.ts - the single YouTube token validate/refresh/rewrite path.
 *
 * Nothing tested this directly; it was only ever exercised sideways, through the sync route. It is
 * the code that decides whether a user is still connected, and it holds a fix worth keeping: a 401
 * means an access token expired, which happens hourly and is recoverable by refreshing. Counting
 * that as an API failure tripped the circuit breaker on every expiry, which then wiped valid tokens
 * and broke "Connect YouTube" - so the distinction between "expired" and "YouTube is unwell" is the
 * behaviour under test, not an implementation detail.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ channelsList: vi.fn(), refresh: vi.fn() }));

vi.mock('../../src/youtube/client', async (importActual) => ({
  ...(await importActual<typeof import('../../src/youtube/client')>()),
  createYoutubeClient: vi.fn((accessToken: string) => ({
    accessToken, // so a test can see WHICH token the returned client is bound to
    channels: { list: h.channelsList },
  })),
  refreshYoutubeAccessToken: h.refresh,
}));

import {
  resolveYouTubeToken,
  ensureValidYouTubeToken,
  YOUTUBE_VALIDATION_QUOTA,
} from '../../src/youtube/auth';
import { YoutubeApiError } from '../../src/youtube/client';
import type { Response, Request } from 'express';

const TOKENS = {
  access_token: 'yt-access',
  refresh_token: 'yt-refresh',
  scope: 'https://www.googleapis.com/auth/youtube',
  token_type: 'Bearer' as const,
};

const res = () => ({ cookie: vi.fn(), clearCookie: vi.fn() }) as unknown as Response;
const req = (cookie?: string) =>
  ({ cookies: cookie === undefined ? {} : { youtube_tokens: cookie } }) as unknown as Request;

beforeEach(() => {
  vi.clearAllMocks();
  h.channelsList.mockResolvedValue({ data: { items: [{ id: 'UC-1' }] } });
});

/**
 * The token records when it dies. Asking YouTube instead costs a quota unit per request to learn
 * what is already in hand - and that price is why this path was left off the routes that needed it,
 * so they read with tokens that had expired and reported the failure as an empty library.
 */
describe('resolveYouTubeToken: what the token already knows', () => {
  const withExpiry = (expiry_date: number) => ({ ...TOKENS, expiry_date });

  it('takes a token that has not expired at its word, and spends nothing', async () => {
    const outcome = await resolveYouTubeToken(withExpiry(Date.now() + 3_600_000), res());

    expect(outcome).toEqual({ status: 'valid', accessToken: 'yt-access', quotaUsed: 0 });
    expect(h.channelsList).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('refreshes an expired one without asking YouTube to confirm it is dead', async () => {
    h.refresh.mockResolvedValue({ access_token: 'fresh-access' });

    const outcome = await resolveYouTubeToken(withExpiry(Date.now() - 1000), res());

    expect(h.channelsList).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'refreshed', accessToken: 'fresh-access' });
  });

  /**
   * A token valid when checked must not die between the check and the call it was checked for.
   * A minute of skew is the difference between a refresh and a request that 401s for no reason the
   * user can act on.
   */
  it('treats one about to expire as already gone', async () => {
    h.refresh.mockResolvedValue({ access_token: 'fresh-access' });

    const outcome = await resolveYouTubeToken(withExpiry(Date.now() + 30_000), res());

    expect(outcome).toMatchObject({ status: 'refreshed' });
  });

  it('asks YouTube when the cookie records no expiry at all', async () => {
    const outcome = await resolveYouTubeToken(TOKENS, res());

    expect(h.channelsList).toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'valid', quotaUsed: 1 });
  });

  /**
   * The status endpoint's job is to say whether YouTube works for this user, which a token's own
   * expiry cannot answer - the call is how quota exhaustion and API health reach the breaker.
   */
  it('still asks when the caller is probing, however fresh the token', async () => {
    const outcome = await resolveYouTubeToken(withExpiry(Date.now() + 3_600_000), res(), {
      probe: true,
    });

    expect(h.channelsList).toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'valid', quotaUsed: 1 });
  });
});

describe('resolveYouTubeToken', () => {
  it('reports a working token as valid, without refreshing it', async () => {
    const outcome = await resolveYouTubeToken(TOKENS, res());

    // TOKENS records no expiry, so there is nothing to reason from and YouTube has to be asked -
    // which is the unit this reports.
    expect(outcome).toEqual({ status: 'valid', accessToken: 'yt-access', quotaUsed: 1 });
    expect(h.refresh).not.toHaveBeenCalled();
  });

  // The cheapest call there is: one quota unit, one field, one row.
  it('validates with the smallest call it can', async () => {
    await resolveYouTubeToken(TOKENS, res());

    expect(h.channelsList).toHaveBeenCalledWith({ part: ['id'], mine: true, maxResults: 1 });
  });

  describe('when the access token has expired (401)', () => {
    // A block body, deliberately: mockRejectedValue returns the mock, and a function returned from
    // beforeEach is a teardown - vitest would call the mock after every test and reject into
    // nothing.
    beforeEach(() => {
      h.channelsList.mockRejectedValue(new YoutubeApiError('expired', 401));
    });

    it('refreshes it and reports the new one', async () => {
      h.refresh.mockResolvedValue({ access_token: 'fresh-access' });

      const outcome = await resolveYouTubeToken(TOKENS, res());

      expect(h.refresh).toHaveBeenCalledWith('yt-refresh');
      // A refresh is an OAuth call, not a YouTube API one: it costs no quota.
      expect(outcome).toEqual({ status: 'refreshed', accessToken: 'fresh-access', quotaUsed: 0 });
    });

    it('writes the refreshed token back to the cookie', async () => {
      h.refresh.mockResolvedValue({ access_token: 'fresh-access' });
      const response = res();

      await resolveYouTubeToken(TOKENS, response);

      const [name, value] = vi.mocked(response.cookie).mock.calls[0]!;
      expect(name).toBe('youtube_tokens');
      expect(JSON.parse(String(value)).access_token).toBe('fresh-access');
    });

    // Google does not re-issue the refresh token, so losing it here is losing the connection.
    it('keeps the refresh token it already had', async () => {
      h.refresh.mockResolvedValue({ access_token: 'fresh-access' });
      const response = res();

      await resolveYouTubeToken(TOKENS, response);

      const [, value] = vi.mocked(response.cookie).mock.calls[0]!;
      expect(JSON.parse(String(value)).refresh_token).toBe('yt-refresh');
    });

    // A cookie written straight from a refresh response is exactly where a malformed token gets
    // persisted unnoticed.
    it('refuses to store a refresh response that is not a usable token', async () => {
      h.refresh.mockResolvedValue({ access_token: '' });
      const response = res();

      const outcome = await resolveYouTubeToken(TOKENS, response);

      expect(response.cookie).not.toHaveBeenCalled();
      expect(outcome.status).toBe('expired');
    });

    it('reports expired, not error, when there is no refresh token to use', async () => {
      const outcome = await resolveYouTubeToken({ ...TOKENS, refresh_token: '' }, res());

      expect(outcome.status).toBe('expired');
      expect(h.refresh).not.toHaveBeenCalled();
    });

    it('reports expired when the refresh itself is rejected', async () => {
      h.refresh.mockRejectedValue(new Error('invalid_grant'));

      const outcome = await resolveYouTubeToken(TOKENS, res());

      expect(outcome.status).toBe('expired');
    });
  });

  /**
   * Anything that is not a 401 is about YouTube, not about this token. Reporting it as expired
   * sends the user off to reconnect an account that is fine.
   */
  describe('when YouTube itself is the problem', () => {
    it.each([
      ['a quota refusal', new YoutubeApiError('quota', 403, 'quotaExceeded'), 403],
      ['a server error', new YoutubeApiError('boom', 500), 500],
      ['a rate limit', new YoutubeApiError('slow down', 429), 429],
    ])('reports %s as an error, carrying the status', async (_label, error, status) => {
      h.channelsList.mockRejectedValue(error);

      const outcome = await resolveYouTubeToken(TOKENS, res());

      expect(outcome).toMatchObject({ status: 'error', statusCode: status });
      expect(h.refresh).not.toHaveBeenCalled();
    });

    it('reports something that is not a YouTube error at all as an error with no status', async () => {
      h.channelsList.mockRejectedValue(new Error('socket hang up'));

      const outcome = await resolveYouTubeToken(TOKENS, res());

      expect(outcome).toMatchObject({ status: 'error', statusCode: undefined });
    });
  });
});

describe('ensureValidYouTubeToken', () => {
  const cookie = JSON.stringify(TOKENS);

  it('hands back a client bound to the working token', async () => {
    const valid = await ensureValidYouTubeToken(req(cookie), res());

    expect((valid.client as unknown as { accessToken: string }).accessToken).toBe('yt-access');
    expect(valid.accessToken).toBe('yt-access');
  });

  it('charges the caller for the validation it did', async () => {
    const valid = await ensureValidYouTubeToken(req(cookie), res());

    expect(valid.quotaUsed).toBe(YOUTUBE_VALIDATION_QUOTA);
  });

  // The client has to be bound to the NEW token, or every call after a refresh uses the dead one.
  it('binds the client to the refreshed token, not the expired one', async () => {
    h.channelsList.mockRejectedValue(new YoutubeApiError('expired', 401));
    h.refresh.mockResolvedValue({ access_token: 'fresh-access' });

    const valid = await ensureValidYouTubeToken(req(cookie), res());

    expect((valid.client as unknown as { accessToken: string }).accessToken).toBe('fresh-access');
    expect(valid.accessToken).toBe('fresh-access');
  });

  it('asks the user to reconnect when there is no cookie', async () => {
    await expect(ensureValidYouTubeToken(req(), res())).rejects.toThrow('YOUTUBE_AUTH_REQUIRED');
  });

  it('asks the user to reconnect when the cookie is not a token', async () => {
    await expect(ensureValidYouTubeToken(req('not json'), res())).rejects.toThrow(
      'YOUTUBE_AUTH_REQUIRED',
    );
  });

  it('asks the user to reconnect when the token cannot be refreshed', async () => {
    h.channelsList.mockRejectedValue(new YoutubeApiError('expired', 401));
    h.refresh.mockRejectedValue(new Error('invalid_grant'));

    await expect(ensureValidYouTubeToken(req(cookie), res())).rejects.toThrow(
      'YOUTUBE_AUTH_REQUIRED',
    );
  });

  // The reason it failed has to survive: "reconnect" with no cause is unfixable from a log.
  it('carries what went wrong as the cause', async () => {
    const cause = new YoutubeApiError('quota', 403, 'quotaExceeded');
    h.channelsList.mockRejectedValue(cause);

    await expect(ensureValidYouTubeToken(req(cookie), res())).rejects.toMatchObject({ cause });
  });
});
