/**
 * Unit tests for the Spotify /items playlist-items helper.
 *
 * This helper replaces spotify-web-api-node's getPlaylistTracks (which calls the
 * removed /tracks endpoint). It must paginate fully and normalize the Feb 2026
 * schema where track data lives under `item` (the legacy `track` field is empty).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAllPlaylistItems } from '../../src/spotify/playlistItems';
import { Logger } from '../../src/lib/logger';

// The client uses Node's global fetch; stub it.
const mockedFetch = vi.fn();
vi.stubGlobal('fetch', mockedFetch);

function jsonResponse(body: any) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as any;
}

const trackUnderItem = (id: string) => ({
  item: { id, name: `Track ${id}`, type: 'track', artists: [{ name: 'A' }] },
});

describe('fetchAllPlaylistItems', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes the new `item` field to `.track`', async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        items: [trackUnderItem('a'), trackUnderItem('b')],
        total: 2,
      }),
    );

    const items = await fetchAllPlaylistItems('token', 'pl1');

    expect(items).toHaveLength(2);
    expect(items[0]!.track?.id).toBe('a');
    expect(items[1]!.track?.name).toBe('Track b');
  });

  it('falls back to the deprecated `track` field when `item` is absent', async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        items: [{ track: { id: 'legacy', name: 'Legacy Track' } }],
        total: 1,
      }),
    );

    const items = await fetchAllPlaylistItems('token', 'pl1');

    expect(items[0]!.track?.id).toBe('legacy');
  });

  it('paginates: a full page is followed by another request, a short page stops it', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => trackUnderItem(`a${i}`));
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ items: fullPage, total: 51 }))
      .mockResolvedValueOnce(jsonResponse({ items: [trackUnderItem('b0')], total: 51 }));

    const items = await fetchAllPlaylistItems('token', 'pl1');

    expect(items).toHaveLength(51);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('sends the bearer token and hits the /items endpoint', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));

    await fetchAllPlaylistItems('my-token', 'pl-xyz');

    const [url, options] = mockedFetch.mock.calls[0]!;
    expect(String(url)).toContain('/playlists/pl-xyz/items');
    expect((options as any).headers.Authorization).toBe('Bearer my-token');
  });

  it('throws an error carrying the HTTP status when the request fails', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: () => Promise.resolve('{"error":{"status":403}}'),
    } as any);

    await expect(fetchAllPlaylistItems('token', 'pl1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('advances the offset by the page size between requests', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => trackUnderItem(`a${i}`));
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ items: fullPage }))
      .mockResolvedValueOnce(jsonResponse({ items: [trackUnderItem('b0')] }));

    await fetchAllPlaylistItems('token', 'pl1');

    // The whole point of pagination: request two must start where request one ended, or every page
    // after the first re-fetches offset 0. A decrementing offset would read offset=-50 here.
    expect(String(mockedFetch.mock.calls[0]![0])).toContain('offset=0');
    expect(String(mockedFetch.mock.calls[1]![0])).toContain('offset=50');
  });

  it('stops on a short page even when the response carries no total', async () => {
    // With no `total` to fall back on, the short-page check is the only thing ending the loop; if it
    // did not fire, the next request would run against an empty mock and the helper would reject.
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({ items: [trackUnderItem('a'), trackUnderItem('b'), trackUnderItem('c')] }),
    );

    const items = await fetchAllPlaylistItems('token', 'pl1');

    expect(items).toHaveLength(3);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('stops after a single full page when the total is exactly one page', async () => {
    // 50 items is a full page, so the short-page check cannot end the loop - the total check must.
    // The boundary is `>=`: at exactly total, we are done; `>` would fetch a needless second page
    // (here an empty mock, so the helper would reject instead of returning the 50 items).
    const fullPage = Array.from({ length: 50 }, (_, i) => trackUnderItem(`a${i}`));
    mockedFetch.mockResolvedValueOnce(jsonResponse({ items: fullPage, total: 50 }));

    const items = await fetchAllPlaylistItems('token', 'pl1');

    expect(items).toHaveLength(50);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a non-numeric total and keeps paging by page length', async () => {
    // The `typeof total === 'number'` guard is why a malformed total cannot short-circuit paging:
    // without it, `all.length >= null` coerces null to 0 and stops after the first full page,
    // dropping every later track.
    const fullPage = Array.from({ length: 50 }, (_, i) => trackUnderItem(`a${i}`));
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ items: fullPage, total: null }))
      .mockResolvedValueOnce(jsonResponse({ items: [trackUnderItem('b0')], total: null }));

    const items = await fetchAllPlaylistItems('token', 'pl1');

    expect(items).toHaveLength(51);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('treats a response with no items array as an empty page', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({ total: 0 }));

    const items = await fetchAllPlaylistItems('token', 'pl1');

    expect(items).toEqual([]);
  });

  it("defaults the error body to '' when the failed response's text() rejects", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.reject(new Error('stream aborted')),
    } as any);

    await expect(fetchAllPlaylistItems('token', 'pl1')).rejects.toMatchObject({
      statusCode: 500,
      body: '',
    });
  });

  it('logs the fetched count against the playlist id', async () => {
    const debug = vi.spyOn(Logger, 'debug').mockImplementation(() => {});
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({ items: [trackUnderItem('a'), trackUnderItem('b')], total: 2 }),
    );

    await fetchAllPlaylistItems('token', 'pl-log');

    expect(debug).toHaveBeenCalledWith('Fetched Spotify playlist items via /items endpoint', {
      playlistId: 'pl-log',
      count: 2,
    });
  });
});
