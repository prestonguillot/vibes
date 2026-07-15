/**
 * reconcilePlaylist: the half that actually writes.
 *
 * The planner (reconcileOps.test.ts) decides what to do. This does it - and nothing had ever run
 * it: every other test in the suite mocks reconcilePlaylist away, so all 45 of its mutants sat in
 * the report as never-executed. It is the code that deletes rows from the user's playlist.
 *
 * computeReconcileOps and assertReconcileSafe are real here. The plan is the planner's business;
 * what this pins is that each op becomes the right API call, in order, and that the safety rail is
 * consulted BEFORE any of them are sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ youtubeWrite: vi.fn() }));

// The real one carries the circuit breaker and the quota counter, which are not this module's
// business - but it must still be the thing every write goes through, so it is called for real
// with a fake behind it.
vi.mock('@/youtube/writes', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/writes')>()),
  youtubeWrite: h.youtubeWrite,
}));

import { reconcilePlaylist } from '@/sync/playlistReconcile';

const PL = 'PL_TARGET';

let youtube: {
  playlistItems: {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

const item = (videoId: string) => ({ videoId, playlistItemId: `item-${videoId}` });

const run = (desired: string[], current: ReturnType<typeof item>[], onProgress?: unknown) =>
  reconcilePlaylist(
    youtube as unknown as Parameters<typeof reconcilePlaylist>[0],
    PL,
    desired,
    current,
    onProgress as Parameters<typeof reconcilePlaylist>[4],
  );

beforeEach(() => {
  vi.clearAllMocks();
  youtube = {
    playlistItems: {
      insert: vi.fn().mockResolvedValue({ data: {} }),
      update: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
  // Run whatever the executor hands it, so the call it wraps really happens.
  h.youtubeWrite.mockImplementation((_op: string, fn: () => Promise<unknown>) => fn());
});

describe('adding videos to an empty playlist', () => {
  it('inserts each at its place, in order', async () => {
    await run(['a', 'b'], []);

    expect(youtube.playlistItems.insert).toHaveBeenCalledTimes(2);
    expect(youtube.playlistItems.insert.mock.calls[0]![0]).toEqual({
      part: ['snippet'],
      requestBody: {
        snippet: {
          playlistId: PL,
          position: 0,
          resourceId: { kind: 'youtube#video', videoId: 'a' },
        },
      },
    });
    expect(youtube.playlistItems.insert.mock.calls[1]![0].requestBody.snippet).toMatchObject({
      position: 1,
      resourceId: { kind: 'youtube#video', videoId: 'b' },
    });
  });

  it('counts what it did', async () => {
    expect(await run(['a', 'b'], [])).toEqual({ inserted: 2, deleted: 0, moved: 0 });
  });

  it('does nothing at all when the playlist already matches', async () => {
    const result = await run(['a', 'b'], [item('a'), item('b')]);

    expect(youtube.playlistItems.insert).not.toHaveBeenCalled();
    expect(youtube.playlistItems.update).not.toHaveBeenCalled();
    expect(youtube.playlistItems.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, deleted: 0, moved: 0 });
  });
});

describe('removing a video that should not be there', () => {
  it('deletes it by its playlist item id, not its video id', async () => {
    await run(['a'], [item('a'), item('gone')]);

    expect(youtube.playlistItems.delete).toHaveBeenCalledWith({ id: 'item-gone' });
  });

  it('counts the delete', async () => {
    expect(await run(['a'], [item('a'), item('gone')])).toEqual({
      inserted: 0,
      deleted: 1,
      moved: 0,
    });
  });
});

describe('putting a playlist back in order', () => {
  // A move is an update that names the existing row and gives it a new position.
  it('moves a video by updating its row', async () => {
    await run(['b', 'a'], [item('a'), item('b')]);

    expect(youtube.playlistItems.update).toHaveBeenCalledWith({
      part: ['snippet'],
      requestBody: {
        id: expect.stringMatching(/^item-/),
        snippet: {
          playlistId: PL,
          position: expect.any(Number),
          resourceId: { kind: 'youtube#video', videoId: expect.any(String) },
        },
      },
    });
  });

  it('counts the move', async () => {
    const result = await run(['b', 'a'], [item('a'), item('b')]);

    expect(result.moved).toBe(1);
    expect(result.inserted).toBe(0);
  });
});

/**
 * Every write goes through youtubeWrite, which is what holds the circuit breaker and the quota
 * counter. A call that goes straight to the client is a call neither of them can see.
 */
describe('the writes it makes', () => {
  it.each([
    [['a'], [], 'playlistItems.insert'],
    [['a'], [item('a'), item('gone')], 'playlistItems.delete'],
    [['b', 'a'], [item('a'), item('b')], 'playlistItems.update'],
  ])('routes %o through youtubeWrite as %s', async (desired, current, operation) => {
    await run(desired as string[], current as ReturnType<typeof item>[]);

    expect(h.youtubeWrite).toHaveBeenCalledWith(operation, expect.any(Function));
  });

  it('stops at the first write that fails, rather than pressing on', async () => {
    youtube.playlistItems.insert
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error('YouTube said no'));

    await expect(run(['a', 'b', 'c'], [])).rejects.toThrow('YouTube said no');

    // The third was never attempted: a playlist half-written is bad, and one written past an error
    // it could not handle is worse.
    expect(youtube.playlistItems.insert).toHaveBeenCalledTimes(2);
  });
});

describe('reporting progress', () => {
  it('counts each op against the total', async () => {
    const seen: Array<[number, number]> = [];

    await run(['a', 'b'], [], (done: number, total: number) => {
      seen.push([done, total]);
    });

    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('waits for a progress callback that returns a promise', async () => {
    const order: string[] = [];
    youtube.playlistItems.insert.mockImplementation(async () => {
      order.push('write');
      return { data: {} };
    });

    await run(['a', 'b'], [], async () => {
      await Promise.resolve();
      order.push('progress');
    });

    // Each write is reported before the next is made, rather than the reports arriving in a heap.
    expect(order).toEqual(['write', 'progress', 'write', 'progress']);
  });

  it('is happy without a progress callback', async () => {
    await expect(run(['a'], [])).resolves.toEqual({ inserted: 1, deleted: 0, moved: 0 });
  });
});

/**
 * The safety rail. A plan that would delete most of the playlist is refused - the likeliest cause
 * is a bad read of what is in it, and acting on that empties something the user cares about.
 */
describe('the delete-safety rail', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => item(`v${i}`));

  it('refuses a plan that would empty the playlist, before sending anything', async () => {
    await expect(run([], many(20))).rejects.toThrow();

    expect(youtube.playlistItems.delete).not.toHaveBeenCalled();
  });

  it('allows a plan that keeps most of it', async () => {
    const current = many(20);
    const desired = current.slice(0, 19).map((i) => i.videoId);

    await expect(run(desired, current)).resolves.toMatchObject({ deleted: 1 });
  });
});
