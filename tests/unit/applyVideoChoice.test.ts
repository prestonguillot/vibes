/**
 * Putting the video the user picked into the playlist (src/sync/applyVideoChoice.ts).
 *
 * This is the only place in the app that writes to a playlist outside a sync, and it is where the
 * quota fix lives: a replace takes the old video's slot and nothing else moves. The previous
 * version re-planned the whole playlist and paid 50 units per move - 84 moves for a single swap
 * against a daily budget of 10,000 - and aborted partway with a 409, leaving the order worse than
 * it found it. None of that was tested; it was inline in routes/playlistDetails.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  findYoutubePlaylistItem: vi.fn(),
  addedVideoPosition: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('@/youtube/playlist', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/playlist')>()),
  findYoutubePlaylistItem: h.findYoutubePlaylistItem,
}));
vi.mock('@/sync/addedVideoPosition', () => ({ addedVideoPosition: h.addedVideoPosition }));
// The real one waits three seconds for YouTube to register the insert.
vi.mock('@/lib/delay', () => ({ sleep: h.sleep }));

import { applyVideoChoice, VideoNotInPlaylistError } from '@/sync/applyVideoChoice';

let youtube: {
  playlistItems: {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

/** A playlist item as the API returns it. */
interface FakeItem {
  id?: string;
  snippet?: { position?: number; resourceId?: { videoId?: string } };
}

/**
 * What the playlist holds. findYoutubePlaylistItem is faked at its boundary but really runs the
 * predicate it is given against these - mocking the search away would leave "which item is this?"
 * untested, and that predicate is what decides the video being deleted.
 */
let playlistItems: FakeItem[];

const apply = (over: { currentVideoId?: string } = {}) =>
  applyVideoChoice({
    youtube: youtube as unknown as Parameters<typeof applyVideoChoice>[0]['youtube'],
    youtubePlaylistId: 'PL',
    spotifyAccessToken: 'sp',
    spotifyPlaylistId: 'SP',
    trackId: 't1',
    newVideoId: 'NEW',
    ...over,
  });

/** The snippet of the insert call at `index`. */
const insertSnippet = (index = 0) =>
  youtube.playlistItems.insert.mock.calls[index]![0].requestBody.snippet;

beforeEach(() => {
  vi.clearAllMocks();
  youtube = {
    playlistItems: {
      insert: vi.fn().mockResolvedValue({ data: { id: 'item-NEW' } }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  playlistItems = [
    { id: 'item-FIRST', snippet: { position: 0, resourceId: { videoId: 'FIRST' } } },
    // YouTube returns items with no snippet at all (a deleted or private video), and items whose
    // snippet names no video. Every predicate here walks past both, so they are in the default
    // playlist rather than in one special case.
    { id: 'item-ghost' },
    { id: 'item-no-resource', snippet: { position: 1 } },
    { id: 'item-OLD', snippet: { position: 3, resourceId: { videoId: 'OLD' } } },
    { id: 'item-NEW', snippet: { position: 9, resourceId: { videoId: 'NEW' } } },
  ];
  h.findYoutubePlaylistItem.mockImplementation(
    async (_youtube: unknown, _playlistId: string, predicate: (item: FakeItem) => boolean) => ({
      item: playlistItems.find(predicate) ?? null,
      itemsScanned: playlistItems.length,
    }),
  );
  h.addedVideoPosition.mockResolvedValue(2);
  h.sleep.mockResolvedValue(undefined);
});

describe('replacing a video the user rejected', () => {
  it('puts the new video in the old one’s place', async () => {
    await apply({ currentVideoId: 'OLD' });

    expect(insertSnippet()).toMatchObject({
      playlistId: 'PL',
      position: 3,
      resourceId: { kind: 'youtube#video', videoId: 'NEW' },
    });
  });

  it('removes the old video', async () => {
    await apply({ currentVideoId: 'OLD' });

    expect(youtube.playlistItems.delete).toHaveBeenCalledWith({ id: 'item-OLD' });
  });

  // Insert first, then delete: the reverse would leave the playlist a video short if the insert
  // failed, and the position would no longer mean anything.
  it('inserts before it deletes', async () => {
    await apply({ currentVideoId: 'OLD' });

    expect(youtube.playlistItems.insert.mock.invocationCallOrder[0]!).toBeLessThan(
      youtube.playlistItems.delete.mock.invocationCallOrder[0]!,
    );
  });

  /**
   * The quota fix. A replace is already in order - the insert took the old slot and the old video
   * came out - so nothing else may move. Re-planning the playlist cost 84 moves and 4,200 units for
   * one swap, and could not finish.
   */
  it('moves nothing else: two writes, whatever the playlist looks like', async () => {
    await apply({ currentVideoId: 'OLD' });

    expect(youtube.playlistItems.insert).toHaveBeenCalledTimes(1);
    expect(youtube.playlistItems.delete).toHaveBeenCalledTimes(1);
    expect(youtube.playlistItems.update).not.toHaveBeenCalled();
  });

  it('does not work out a position: the old slot is the answer', async () => {
    await apply({ currentVideoId: 'OLD' });

    expect(h.addedVideoPosition).not.toHaveBeenCalled();
  });

  it('reports a replace that is in order', async () => {
    expect(await apply({ currentVideoId: 'OLD' })).toEqual({ mode: 'replace', placed: true });
  });

  // A video at the front reports position 0, which is falsy - `|| 0` must not turn it into
  // something else, and a missing position must not throw.
  it.each([
    [0, 0],
    [undefined, 0],
    [7, 7],
  ])('inserts at the old video’s position %o', async (position, expected) => {
    playlistItems = [{ id: 'item-OLD', snippet: { position, resourceId: { videoId: 'OLD' } } }];

    await apply({ currentVideoId: 'OLD' });

    expect(insertSnippet().position).toBe(expected);
  });

  // It must find the video by its id rather than take whatever the first page holds.
  it('replaces the video asked for, not another one', async () => {
    await apply({ currentVideoId: 'FIRST' });

    expect(youtube.playlistItems.delete).toHaveBeenCalledWith({ id: 'item-FIRST' });
    expect(insertSnippet().position).toBe(0);
  });

  // position lives on the snippet; asking for the wrong parts would return an item without one.
  it('asks for the parts it reads', async () => {
    await apply({ currentVideoId: 'OLD' });

    expect(h.findYoutubePlaylistItem).toHaveBeenCalledWith(youtube, 'PL', expect.any(Function), [
      'snippet',
      'contentDetails',
    ]);
  });

  // The insert sends a snippet, so it has to say so - YouTube rejects a write whose parts do not
  // name what the body carries.
  it('writes the snippet part', async () => {
    await apply({ currentVideoId: 'OLD' });

    expect(youtube.playlistItems.insert.mock.calls[0]![0].part).toEqual(['snippet']);
  });

  // An item the API returned without a videoId is not the video being looked for.
  it('is not fooled by an item with no video id', async () => {
    playlistItems = [
      { id: 'item-broken', snippet: { position: 0 } },
      { id: 'item-OLD', snippet: { position: 3, resourceId: { videoId: 'OLD' } } },
    ];

    await apply({ currentVideoId: 'OLD' });

    expect(youtube.playlistItems.delete).toHaveBeenCalledWith({ id: 'item-OLD' });
  });
});

/**
 * The playlist has moved on since the page was rendered. Writing anyway would insert a video the
 * user asked to be a replacement, next to the one it was supposed to replace.
 */
describe('when the video to replace has gone', () => {
  beforeEach(() => {
    // The playlist has moved on: OLD is not in it any more.
    playlistItems = [{ id: 'item-OTHER', snippet: { position: 0, resourceId: { videoId: 'X' } } }];
  });

  it('writes nothing', async () => {
    await expect(apply({ currentVideoId: 'OLD' })).rejects.toThrow(VideoNotInPlaylistError);

    expect(youtube.playlistItems.insert).not.toHaveBeenCalled();
    expect(youtube.playlistItems.delete).not.toHaveBeenCalled();
  });

  it('says what it could not find, and how far it looked', async () => {
    const error = await apply({ currentVideoId: 'OLD' }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(VideoNotInPlaylistError);
    expect(error).toMatchObject({ name: 'VideoNotInPlaylistError' });
    expect((error as Error).message).toBe('Video OLD is not in the playlist (checked 1 items)');
  });

  // The count is in the message the user reads: "after checking all N items".
  it('says how much of the playlist it checked', async () => {
    playlistItems = Array.from({ length: 42 }, (_, i) => ({
      id: `item-${i}`,
      snippet: { position: i, resourceId: { videoId: `v${i}` } },
    }));

    await expect(apply({ currentVideoId: 'OLD' })).rejects.toMatchObject({
      videoId: 'OLD',
      itemsScanned: 42,
    });
  });
});

describe('linking a track that had no video', () => {
  it('appends it, with no position', async () => {
    await apply();

    expect(insertSnippet()).toMatchObject({
      playlistId: 'PL',
      resourceId: { kind: 'youtube#video', videoId: 'NEW' },
    });
    expect(insertSnippet().position).toBeUndefined();
    expect(youtube.playlistItems.insert.mock.calls[0]![0].part).toEqual(['snippet']);
  });

  it('waits before moving it: YouTube will not move an item it has not registered', async () => {
    await apply();

    expect(h.sleep).toHaveBeenCalledWith(3000);
    expect(h.sleep.mock.invocationCallOrder[0]!).toBeLessThan(
      youtube.playlistItems.update.mock.invocationCallOrder[0]!,
    );
  });

  // It moves the video it just added, addressed by that video's own playlist item.
  it('moves it to its track’s place', async () => {
    await apply();

    expect(youtube.playlistItems.update).toHaveBeenCalledWith({
      part: ['snippet'],
      requestBody: {
        id: 'item-NEW',
        snippet: {
          playlistId: 'PL',
          position: 2,
          resourceId: { kind: 'youtube#video', videoId: 'NEW' },
        },
      },
    });
  });

  // Only the snippet is read to find the item to move; asking for more costs nothing but says the
  // wrong thing about what this needs.
  it('asks for the snippet when finding the video to move', async () => {
    await apply();

    expect(h.findYoutubePlaylistItem).toHaveBeenLastCalledWith(
      youtube,
      'PL',
      expect.any(Function),
      ['snippet'],
    );
  });

  it('reports an addition that landed where it should', async () => {
    expect(await apply()).toEqual({ mode: 'add', placed: true });
  });

  it.each([[''], [undefined]])('treats currentVideoId %o as a link, not a replace', async (id) => {
    const result = await apply({ currentVideoId: id });

    expect(result.mode).toBe('add');
    expect(youtube.playlistItems.delete).not.toHaveBeenCalled();
  });

  // Nothing to be beside: the track is gone from Spotify. The end of the playlist is as good a
  // place as any, and it is not a failure.
  it('leaves it at the end when its track has left the Spotify playlist', async () => {
    h.addedVideoPosition.mockResolvedValue(null);

    const result = await apply();

    expect(youtube.playlistItems.update).not.toHaveBeenCalled();
    expect(result).toEqual({ mode: 'add', placed: true });
  });
});

/**
 * The insert landed, so the video IS linked and IS in the playlist - only its position is wrong.
 * Reporting that as a failure would tell the user to retry a write that worked; reporting it as
 * plain success is how a playlist ends up in an order nobody chose with nothing having said so.
 */
describe('when the added video cannot be placed', () => {
  it('keeps the video and admits it is in the wrong place', async () => {
    h.addedVideoPosition.mockRejectedValue(new Error('Spotify is down'));

    const result = await apply();

    expect(result).toEqual({ mode: 'add', placed: false });
  });

  it('does not undo the insert', async () => {
    h.addedVideoPosition.mockRejectedValue(new Error('Spotify is down'));

    await apply();

    expect(youtube.playlistItems.insert).toHaveBeenCalledTimes(1);
    expect(youtube.playlistItems.delete).not.toHaveBeenCalled();
  });

  it('admits it when the move itself fails', async () => {
    youtube.playlistItems.update.mockRejectedValue(new Error('409'));

    expect(await apply()).toEqual({ mode: 'add', placed: false });
  });

  it('admits it when the video cannot be found to move', async () => {
    // The insert has not shown up in the playlist yet, so there is nothing to move.
    playlistItems = [{ id: 'item-FIRST', snippet: { position: 0, resourceId: { videoId: 'F' } } }];

    expect(await apply()).toEqual({ mode: 'add', placed: false });
  });

  // An item YouTube returned without an id cannot be addressed, so it cannot be moved.
  it('admits it when the video in the playlist has no item id', async () => {
    playlistItems = [{ snippet: { position: 9, resourceId: { videoId: 'NEW' } } }];

    expect(await apply()).toEqual({ mode: 'add', placed: false });
  });
});
