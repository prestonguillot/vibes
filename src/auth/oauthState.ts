/**
 * OAuth `state` CSRF protection, shared by the provider login/callback flows.
 *
 * Without it, an attacker can trick a victim's browser into completing the connect with the
 * ATTACKER's authorization code, binding the attacker's account to the victim's session
 * (login-CSRF / account fixation). Spotify had this; YouTube did not.
 *
 * SameSite=lax (not strict) is deliberate: the callback is a cross-site top-level navigation back
 * from the provider, and Strict would withhold the cookie there, so verification would fail every
 * time.
 */

import { Request, Response } from 'express';
import { generateCsrfToken } from './csrf';
import { Logger } from '../lib/logger';

const stateCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 10 * 60 * 1000, // 10 minutes
  path: '/',
});

/**
 * Mints a random state, stores it in a one-time cookie, and returns it for the authorize URL.
 *
 * (Spotify additionally REQUIRES a non-empty state: its authorize endpoint renders a generic
 * error page for an authenticated user when `state=` is present but empty.)
 */
export function issueOAuthState(res: Response, cookieName: string): string {
  const state = generateCsrfToken();
  res.cookie(cookieName, state, stateCookieOptions());
  return state;
}

/**
 * Verifies a callback's state against the one-time cookie. The cookie is single-use, so it is
 * cleared regardless of outcome. Returns false when the caller should reject the callback.
 */
export function verifyOAuthState(
  req: Request,
  res: Response,
  cookieName: string,
  receivedState: string | undefined,
  service: string,
): boolean {
  const expectedState = req.cookies?.[cookieName];
  res.clearCookie(cookieName, { path: '/' });

  if (!expectedState || !receivedState || receivedState !== expectedState) {
    Logger.warn(`${service} callback rejected - OAuth state mismatch`, {
      hasExpectedState: !!expectedState,
      hasReceivedState: !!receivedState,
    });
    return false;
  }
  return true;
}
