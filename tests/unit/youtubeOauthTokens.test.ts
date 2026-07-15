/**
 * Unit tests for the YouTube OAuth token responses (src/youtube/client.ts).
 *
 * These coerced blindly: String(data.access_token) turned a missing field into the literal string
 * "undefined" (stored as a plausible-looking token, failing later as a confusing 401), and
 * Number(data.expires_in ?? 0) made expiry_date === Date.now() so the token was born expired.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exchangeYoutubeCode,
  refreshYoutubeAccessToken,
  YoutubeApiError,
} from '../../src/youtube/client';

const mockFetch = vi.fn();
const okJson = (data: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(data) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  process.env.YOUTUBE_CLIENT_ID = 'cid';
  process.env.YOUTUBE_CLIENT_SECRET = 'secret';
  process.env.YOUTUBE_REDIRECT_URI = 'http://127.0.0.1:3000/auth/youtube/callback';
});

describe('exchangeYoutubeCode', () => {
  it('maps a well-formed token response', async () => {
    mockFetch.mockResolvedValue(
      okJson({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 's' }),
    );

    const tokens = await exchangeYoutubeCode('code');

    expect(tokens.access_token).toBe('AT');
    expect(tokens.refresh_token).toBe('RT');
    expect(tokens.expiry_date).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it('rejects a response with no access_token instead of storing "undefined"', async () => {
    mockFetch.mockResolvedValue(okJson({ expires_in: 3600 }));

    await expect(exchangeYoutubeCode('code')).rejects.toBeInstanceOf(YoutubeApiError);
  });

  it('rejects a non-string access_token', async () => {
    mockFetch.mockResolvedValue(okJson({ access_token: 12345, expires_in: 3600 }));

    await expect(exchangeYoutubeCode('code')).rejects.toBeInstanceOf(YoutubeApiError);
  });

  it('assumes the default lifetime when expires_in is missing, rather than expiring instantly', async () => {
    mockFetch.mockResolvedValue(okJson({ access_token: 'AT' }));

    const tokens = await exchangeYoutubeCode('code');

    // Previously expiry_date === Date.now(): born expired, so every request tried to refresh.
    expect(tokens.expiry_date).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it('assumes the default lifetime when expires_in is garbage', async () => {
    mockFetch.mockResolvedValue(okJson({ access_token: 'AT', expires_in: 'soon' }));

    const tokens = await exchangeYoutubeCode('code');

    expect(tokens.expiry_date).toBeGreaterThan(Date.now() + 3_500_000);
  });
});

describe('refreshYoutubeAccessToken', () => {
  it('rejects a refresh response with no access_token', async () => {
    mockFetch.mockResolvedValue(okJson({ expires_in: 3600 }));

    await expect(refreshYoutubeAccessToken('RT')).rejects.toBeInstanceOf(YoutubeApiError);
  });

  it('assumes the default lifetime when a refresh omits expires_in', async () => {
    mockFetch.mockResolvedValue(okJson({ access_token: 'AT2' }));

    const tokens = await refreshYoutubeAccessToken('RT');

    expect(tokens.access_token).toBe('AT2');
    expect(tokens.expiry_date).toBeGreaterThan(Date.now() + 3_500_000);
  });
});
