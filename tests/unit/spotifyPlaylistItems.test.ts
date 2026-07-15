/**
 * Unit tests for the Spotify /items playlist-items helper.
 *
 * This helper replaces spotify-web-api-node's getPlaylistTracks (which calls the
 * removed /tracks endpoint). It must paginate fully and normalize the Feb 2026
 * schema where track data lives under `item` (the legacy `track` field is empty).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAllPlaylistItems } from '../../src/spotify/playlistItems';

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
});
