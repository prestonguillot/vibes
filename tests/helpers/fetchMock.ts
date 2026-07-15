import { vi } from 'vitest';

/**
 * Response stand-ins for tests that stub global fetch.
 *
 * Every test file was hand-rolling its own (tests/unit/spotifyClient.test.ts had the fullest
 * version). The scraper needs more than any of them did: `headers.getSetCookie()` for the cookie
 * jar and `headers.get('location')` for manual redirect following.
 *
 * These are deliberately object literals cast to Response rather than real Responses - a real one
 * cannot be constructed with a 302 + Location in Node without an actual fetch, and the code only
 * ever touches the handful of fields modelled here.
 */

interface ResponseInit {
  status?: number;
  statusText?: string;
  url?: string;
  body?: string;
  headers?: Record<string, string>;
  /** Raw Set-Cookie header lines, as fetch's headers.getSetCookie() returns them. */
  setCookie?: string[];
  /** Omit getSetCookie entirely, modelling a runtime that does not implement it. */
  noGetSetCookie?: boolean;
}

export function fakeResponse(init: ResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v] as const),
  );

  const headerImpl: Record<string, unknown> = {
    get: (name: string) => headers.get(name.toLowerCase()) ?? null,
  };
  if (!init.noGetSetCookie) {
    headerImpl.getSetCookie = () => init.setCookie ?? [];
  }

  return {
    status,
    statusText: init.statusText ?? '',
    ok: status >= 200 && status < 300,
    url: init.url ?? '',
    headers: headerImpl,
    text: async () => init.body ?? '',
    json: async () => JSON.parse(init.body ?? '{}'),
  } as unknown as Response;
}

/** A 3xx with a Location, and optionally cookies to hand back. */
export const redirectResponse = (location: string, opts: Partial<ResponseInit> = {}) =>
  fakeResponse({ status: 302, headers: { location }, ...opts });

/** Stub global fetch with a scripted queue; the last entry repeats once exhausted. */
export function stubFetchSequence(responses: Response[]) {
  let call = 0;
  const mock = vi.fn(async () => {
    const response = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** The request options fetch was called with on a given (0-based) call. */
export function requestAt(mock: ReturnType<typeof vi.fn>, index: number) {
  const call = mock.mock.calls[index] as [string, RequestInit] | undefined;
  if (!call) throw new Error(`fetch was not called ${index + 1} time(s)`);
  return {
    url: call[0],
    init: call[1],
    headers: (call[1]?.headers ?? {}) as Record<string, string>,
  };
}
