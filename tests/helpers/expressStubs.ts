import { vi } from 'vitest';
import type { Request, Response } from 'express';

/**
 * Minimal req/res stand-ins for testing middleware directly.
 *
 * The alternative is driving middleware through createApp() + supertest, which for csrf means
 * dragging in the Spotify/YouTube mocks of whichever route it happens to be mounted on. These
 * model only what the middleware touches.
 */

export function fakeRequest(over: Partial<Request> = {}): Request {
  return {
    cookies: {},
    headers: {},
    method: 'POST',
    originalUrl: '/api/test',
    ...over,
  } as unknown as Request;
}

export interface FakeResponse {
  res: Response;
  /** res.cookie(name, value, options) calls. */
  cookies: () => Array<{ name: string; value: string; options: Record<string, unknown> }>;
  /** The status passed to res.status(). */
  statusCode: () => number | undefined;
  /** The body passed to res.json(). */
  body: () => unknown;
  locals: Record<string, unknown>;
}

export function fakeResponse(): FakeResponse {
  const cookieCalls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  let status: number | undefined;
  let body: unknown;
  const locals: Record<string, unknown> = {};

  const res = {
    locals,
    cookie: vi.fn((name: string, value: string, options: Record<string, unknown> = {}) => {
      cookieCalls.push({ name, value, options });
      return res;
    }),
    clearCookie: vi.fn(() => res),
    status: vi.fn((code: number) => {
      status = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      body = payload;
      return res;
    }),
    send: vi.fn(() => res),
    set: vi.fn(() => res),
  };

  return {
    res: res as unknown as Response,
    cookies: () => cookieCalls,
    statusCode: () => status,
    body: () => body,
    locals,
  };
}
