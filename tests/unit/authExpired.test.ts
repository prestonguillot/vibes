/**
 * Which errors mean "connect again" (src/auth/authExpired.ts).
 *
 * ensureValidSpotifyToken and ensureValidYouTubeToken throw these to say the user has to reconnect.
 * Only the sync stream ever answered; every other route let it reach a generic handler and rendered
 * "something went wrong, please try again" - which is not something trying again fixes, and never
 * offers the one action that does.
 */

import { describe, it, expect } from 'vitest';
import { authExpired } from '@/auth/authExpired';

describe('authExpired', () => {
  it('names Spotify, and where to reconnect', () => {
    expect(authExpired(new Error('SPOTIFY_AUTH_REQUIRED'))).toEqual({
      service: 'Spotify',
      loginUrl: '/auth/spotify/login',
    });
  });

  it('names YouTube, and where to reconnect', () => {
    expect(authExpired(new Error('YOUTUBE_AUTH_REQUIRED'))).toEqual({
      service: 'YouTube',
      loginUrl: '/auth/youtube/login',
    });
  });

  /**
   * loginUrl is not optional: partials/auth-expired.ejs links it, and rendering without it throws,
   * which express turns into a 500 - an expired session reported as a crash. That has happened
   * here before.
   */
  it.each([
    ['SPOTIFY_AUTH_REQUIRED', '/auth/spotify/login'],
    ['YOUTUBE_AUTH_REQUIRED', '/auth/youtube/login'],
  ])('always carries a login url for %s', (message, url) => {
    expect(authExpired(new Error(message))?.loginUrl).toBe(url);
  });

  it.each([
    ['an unrelated error', new Error('ECONNRESET')],
    ['a YouTube quota refusal', new Error('quotaExceeded')],
    ['something that is not an Error', 'YOUTUBE_AUTH_REQUIRED'],
    ['nothing at all', undefined],
    ['null', null],
  ])('does not claim %s is an expired session', (_label, error) => {
    expect(authExpired(error)).toBeNull();
  });

  // The message is matched whole: a longer message that merely contains it is a different error,
  // and reporting it as an expired session would send the user to reconnect for no reason.
  it('does not match a message that merely mentions it', () => {
    expect(authExpired(new Error('caused by YOUTUBE_AUTH_REQUIRED upstream'))).toBeNull();
  });
});
