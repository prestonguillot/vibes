/**
 * Tests for the playlistItems.list pagination helpers in src/youtube/playlist.ts.
 *
 * Two behaviours the callers depend on, neither of which a plain "fetch all" provides:
 *  - the sync route counts quota per page request, so the page hook fires once per request;
 *  - the replace route stops paging at the item it wants, so a long playlist is not walked in
 *    full on a user-facing path.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchAllYoutubePlaylistItems,
  fetchAllYoutubePlaylists,
  findYoutubePlaylistItem,
  findSyncedYoutubePlaylist,
} from '../../src/youtube/playlist';
import type { YoutubeClient, YtPlaylist, YtPlaylistItem } from '../../src/youtube/client';

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

/**
 * The user's own playlists, which findSyncedYoutubePlaylist walks to decide whether a Spotify
 * playlist has been synced. A truncated walk here is a synced playlist reported as unsynced, and a
 * mine:false request is somebody else's playlists entirely.
 */
function clientWithPlaylistPages(pages: YtPlaylist[][]) {
  const requests: Array<{ part: string[]; mine?: boolean; pageToken?: string }> = [];
  const list = vi.fn(async (params: { part: string[]; mine?: boolean; pageToken?: string }) => {
    requests.push(params);
    const index = params.pageToken ? Number(params.pageToken) : 0;
    const isLast = index === pages.length - 1;
    return {
      data: { items: pages[index], nextPageToken: isLast ? undefined : String(index + 1) },
    };
  });
  return { client: { playlists: { list } } as unknown as YoutubeClient, requests };
}

const playlist = (id: string, title: string): YtPlaylist =>
  ({ id, snippet: { title } }) as YtPlaylist;

describe('fetchAllYoutubePlaylists', () => {
  it('returns every playlist across pages', async () => {
    const { client } = clientWithPlaylistPages([
      [playlist('p1', 'A'), playlist('p2', 'B')],
      [playlist('p3', 'C')],
    ]);

    const all = await fetchAllYoutubePlaylists(client);

    expect(all.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  // The second page is only reached by following nextPageToken; a broken loop returns page one and
  // silently drops the rest, which is a synced playlist that lives on page two read as unsynced.
  it('follows the page token to the end', async () => {
    const { client, requests } = clientWithPlaylistPages([
      [playlist('p1', 'A')],
      [playlist('p2', 'B')],
    ]);

    await fetchAllYoutubePlaylists(client);

    expect(requests).toHaveLength(2);
    expect(requests[1]!.pageToken).toBe('1');
  });

  it('asks for the current user, and the parts it reads', async () => {
    const { client, requests } = clientWithPlaylistPages([[playlist('p1', 'A')]]);

    await fetchAllYoutubePlaylists(client);

    expect(requests[0]!.mine).toBe(true);
    expect(requests[0]!.part).toEqual(['id', 'snippet', 'contentDetails']);
  });

  it('handles a user with no playlists', async () => {
    const { client } = clientWithPlaylistPages([[]]);

    expect(await fetchAllYoutubePlaylists(client)).toEqual([]);
  });
});

describe('findSyncedYoutubePlaylist', () => {
  it('finds the playlist whose title is the synced-title of the Spotify one', async () => {
    const { client } = clientWithPlaylistPages([
      [playlist('other', 'Unrelated'), playlist('match', 'My Mix (from Spotify)')],
    ]);

    const found = await findSyncedYoutubePlaylist(client, 'My Mix');

    expect(found?.id).toBe('match');
  });

  // The suffix is the whole convention: a YouTube playlist that merely shares the Spotify name is
  // not the synced one, and treating it as such would sync into a playlist the user made by hand.
  it('does not match a playlist that lacks the (from Spotify) suffix', async () => {
    const { client } = clientWithPlaylistPages([[playlist('bare', 'My Mix')]]);

    expect(await findSyncedYoutubePlaylist(client, 'My Mix')).toBeNull();
  });

  it('is null when the user has no matching playlist', async () => {
    const { client } = clientWithPlaylistPages([[playlist('p1', 'Something Else (from Spotify)')]]);

    expect(await findSyncedYoutubePlaylist(client, 'My Mix')).toBeNull();
  });
});
