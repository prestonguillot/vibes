/**
 * Tests for the playlistItems.list pagination helpers in src/youtube/playlist.ts.
 *
 * Two behaviours the callers depend on, neither of which a plain "fetch all" provides:
 *  - the sync route counts quota per page request, so the page hook fires once per request;
 *  - the replace route stops paging at the item it wants, so a long playlist is not walked in
 *    full on a user-facing path.
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchAllYoutubePlaylistItems, findYoutubePlaylistItem } from '../../src/youtube/playlist';
import type { YoutubeClient, YtPlaylistItem } from '../../src/youtube/client';

const item = (videoId: string): YtPlaylistItem =>
  ({ id: `item-${videoId}`, snippet: { resourceId: { videoId } } }) as YtPlaylistItem;

/**
 * A YouTube client whose playlistItems.list serves the given pages, honouring pageToken.
 * Records every request so tests can assert what was actually asked of the API.
 */
function clientWithPages(pages: YtPlaylistItem[][]) {
  const requests: Array<{ part: string[]; pageToken?: string; playlistId: string }> = [];

  const list = vi.fn(async (params: { part: string[]; pageToken?: string; playlistId: string }) => {
    requests.push(params);
    const index = params.pageToken ? Number(params.pageToken) : 0;
    const isLast = index === pages.length - 1;
    return {
      data: {
        items: pages[index],
        nextPageToken: isLast ? undefined : String(index + 1),
      },
    };
  });

  return { client: { playlistItems: { list } } as unknown as YoutubeClient, requests };
}

describe('fetchAllYoutubePlaylistItems', () => {
  it('returns every item across pages, in order', async () => {
    const { client } = clientWithPages([[item('a'), item('b')], [item('c')]]);

    const all = await fetchAllYoutubePlaylistItems(client, 'PL1');

    expect(all.map((i) => i.snippet?.resourceId?.videoId)).toEqual(['a', 'b', 'c']);
  });

  it('requests the parts the caller asked for', async () => {
    const { client, requests } = clientWithPages([[item('a')]]);

    await fetchAllYoutubePlaylistItems(client, 'PL1', ['snippet', 'contentDetails']);

    expect(requests[0]).toMatchObject({
      part: ['snippet', 'contentDetails'],
      playlistId: 'PL1',
    });
  });

  it('reports each page request so the caller can account for its quota', async () => {
    const { client } = clientWithPages([[item('a'), item('b')], [item('c')]]);
    const onPage = vi.fn();

    await fetchAllYoutubePlaylistItems(client, 'PL1', ['id', 'snippet'], onPage);

    // One call per request against the API - that is what costs a quota unit, not one per item.
    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenNthCalledWith(1, 2);
    expect(onPage).toHaveBeenNthCalledWith(2, 1);
  });

  it('handles a playlist with no items', async () => {
    const { client } = clientWithPages([[]]);

    expect(await fetchAllYoutubePlaylistItems(client, 'PL1')).toEqual([]);
  });
});

describe('findYoutubePlaylistItem', () => {
  it('stops paging as soon as the item is found', async () => {
    const { client, requests } = clientWithPages([
      [item('a'), item('b')],
      [item('c')],
      [item('d')],
    ]);

    const { item: found, itemsScanned } = await findYoutubePlaylistItem(
      client,
      'PL1',
      (i) => i.snippet?.resourceId?.videoId === 'b',
    );

    expect(found?.id).toBe('item-b');
    expect(itemsScanned).toBe(2);
    expect(requests).toHaveLength(1); // pages 2 and 3 were never requested
  });

  it('walks every page when the item is on the last one', async () => {
    const { client, requests } = clientWithPages([[item('a')], [item('b')], [item('c')]]);

    const { item: found, itemsScanned } = await findYoutubePlaylistItem(
      client,
      'PL1',
      (i) => i.snippet?.resourceId?.videoId === 'c',
    );

    expect(found?.id).toBe('item-c');
    expect(itemsScanned).toBe(3);
    expect(requests).toHaveLength(3);
  });

  it('reports how much was searched when the item is absent', async () => {
    const { client } = clientWithPages([[item('a')], [item('b')]]);

    const { item: found, itemsScanned } = await findYoutubePlaylistItem(
      client,
      'PL1',
      (i) => i.snippet?.resourceId?.videoId === 'missing',
    );

    expect(found).toBeNull();
    expect(itemsScanned).toBe(2);
  });
});
