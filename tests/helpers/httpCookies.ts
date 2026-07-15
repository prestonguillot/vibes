import type { Response } from 'supertest';

/**
 * The Set-Cookie headers on a response, always as a list.
 *
 * supertest types `headers` as Record<string, string>, but Set-Cookie is the one header that
 * legitimately repeats, so at runtime it arrives as an array. Every caller was hand-rolling the
 * same `([] as string[]).concat(...)` dance to paper over that, which typechecking flagged the
 * moment it was turned on.
 */
export function setCookies(response: Response): string[] {
  const raw = response.headers['set-cookie'] as string | string[] | undefined;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** The first Set-Cookie header for a given cookie name, if the response set one. */
export function findSetCookie(response: Response, name: string): string | undefined {
  return setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
}
