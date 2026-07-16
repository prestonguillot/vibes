/**
 * Unit tests for the reconcile planner (computeReconcileOps): given a desired
 * order of video IDs and the playlist's current items, it returns the minimal
 * delete/insert/move ops to make the playlist match - honoring the explicit
 * desired order without any content matching.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeReconcileOps,
  buildSyncDesiredVideoIds,
  assertReconcileSafe,
  ReconcileSafetyError,
  CurrentPlaylistItem,
} from '../../src/sync/playlistReconcile';
import { Logger } from '../../src/lib/logger';

const ci = (...videoIds: string[]): CurrentPlaylistItem[] =>
  videoIds.map((videoId) => ({ videoId, playlistItemId: `pi-${videoId}` }));

describe('computeReconcileOps', () => {
  it('returns no ops when already in the desired order', () => {
    expect(computeReconcileOps(['a', 'b', 'c'], ci('a', 'b', 'c'))).toEqual([]);
  });

  it('handles empty playlist and empty desired', () => {
    expect(computeReconcileOps([], [])).toEqual([]);
  });

  it('appends a missing video at the end', () => {
    expect(computeReconcileOps(['a', 'b', 'c'], ci('a', 'b'))).toEqual([
      { kind: 'insert', videoId: 'c', position: 2 },
    ]);
  });

  it('inserts a missing video in the middle', () => {
    expect(computeReconcileOps(['a', 'b', 'c'], ci('a', 'c'))).toEqual([
      { kind: 'insert', videoId: 'b', position: 1 },
    ]);
  });

  it('deletes an orphan video not in the desired order', () => {
    expect(computeReconcileOps(['a', 'b'], ci('a', 'x', 'b'))).toEqual([
      { kind: 'delete', playlistItemId: 'pi-x', videoId: 'x' },
    ]);
  });

  it('deletes duplicate occurrences of a desired video', () => {
    expect(computeReconcileOps(['a', 'b'], ci('a', 'a', 'b'))).toEqual([
      { kind: 'delete', playlistItemId: 'pi-a', videoId: 'a' },
    ]);
  });

  it('moves a manually-added video from the end into its correct slot (the bug case)', () => {
    // 'NEW' was appended by the manual-add flow; desired wants it at index 1.
    expect(computeReconcileOps(['a', 'NEW', 'b'], ci('a', 'b', 'NEW'))).toEqual([
      { kind: 'move', playlistItemId: 'pi-NEW', videoId: 'NEW', position: 1 },
    ]);
  });

  it('replaces a video: deletes the old, inserts the new in place', () => {
    expect(computeReconcileOps(['a', 'NEW', 'c'], ci('a', 'OLD', 'c'))).toEqual([
      { kind: 'delete', playlistItemId: 'pi-OLD', videoId: 'OLD' },
      { kind: 'insert', videoId: 'NEW', position: 1 },
    ]);
  });

  it('reorders a reversed playlist with moves only', () => {
    const ops = computeReconcileOps(['c', 'b', 'a'], ci('a', 'b', 'c'));
    expect(ops).toEqual([
      { kind: 'move', playlistItemId: 'pi-c', videoId: 'c', position: 0 },
      { kind: 'move', playlistItemId: 'pi-b', videoId: 'b', position: 1 },
    ]);
  });

  it('builds an empty playlist entirely from inserts', () => {
    expect(computeReconcileOps(['a', 'b'], [])).toEqual([
      { kind: 'insert', videoId: 'a', position: 0 },
      { kind: 'insert', videoId: 'b', position: 1 },
    ]);
  });

  it('removes everything when desired is empty', () => {
    expect(computeReconcileOps([], ci('a', 'b'))).toEqual([
      { kind: 'delete', playlistItemId: 'pi-a', videoId: 'a' },
      { kind: 'delete', playlistItemId: 'pi-b', videoId: 'b' },
    ]);
  });

  it('combines delete, insert and move in one plan', () => {
    // current: a, ORPHAN, c, b   desired: a, b, c
    const ops = computeReconcileOps(['a', 'b', 'c'], ci('a', 'ORPHAN', 'c', 'b'));
    expect(ops).toEqual([
      { kind: 'delete', playlistItemId: 'pi-ORPHAN', videoId: 'ORPHAN' },
      { kind: 'move', playlistItemId: 'pi-b', videoId: 'b', position: 1 },
    ]);
  });
});

describe('buildSyncDesiredVideoIds', () => {
  const order = ['t1', 't2', 't3'];

  it('emits videos in Spotify track order', () => {
    const result = buildSyncDesiredVideoIds(
      order,
      [
        { trackId: 't1', videoId: 'v1' },
        { trackId: 't2', videoId: 'v2' },
        { trackId: 't3', videoId: 'v3' },
      ],
      [],
    );
    expect(result).toEqual(['v1', 'v2', 'v3']);
  });

  it('combines existing matches with new search results', () => {
    // t1/t3 already matched; t2 newly searched.
    const result = buildSyncDesiredVideoIds(
      order,
      [
        { trackId: 't1', videoId: 'v1' },
        { trackId: 't3', videoId: 'v3' },
      ],
      [{ spotifyTrackId: 't2', videoId: 'v2', found: true }],
    );
    expect(result).toEqual(['v1', 'v2', 'v3']);
  });

  it('skips tracks with no video (unfound / unmatched)', () => {
    const result = buildSyncDesiredVideoIds(
      order,
      [{ trackId: 't1', videoId: 'v1' }],
      [{ spotifyTrackId: 't3', videoId: 'v3', found: true }],
      // t2 has neither -> skipped, but order of the rest is preserved
    );
    expect(result).toEqual(['v1', 'v3']);
  });

  it('ignores unfound search results', () => {
    const result = buildSyncDesiredVideoIds(
      order,
      [],
      [
        { spotifyTrackId: 't1', videoId: undefined, found: false },
        { spotifyTrackId: 't2', videoId: 'v2', found: true },
      ],
    );
    expect(result).toEqual(['v2']);
  });

  it('lets a new search override an existing match for the same track', () => {
    const result = buildSyncDesiredVideoIds(
      ['t1'],
      [{ trackId: 't1', videoId: 'old' }],
      [{ spotifyTrackId: 't1', videoId: 'new', found: true }],
    );
    expect(result).toEqual(['new']);
  });

  it('emits a video at most once even if two tracks map to it', () => {
    const result = buildSyncDesiredVideoIds(
      ['t1', 't2'],
      [
        { trackId: 't1', videoId: 'dup' },
        { trackId: 't2', videoId: 'dup' },
      ],
      [],
    );
    expect(result).toEqual(['dup']);
  });

  // `found` is load-bearing on its own: a result that carries a videoId but was NOT found must not
  // be used, or a stale/guessed video slips into the desired order.
  it('ignores a not-found search result even when it carries a video id', () => {
    const result = buildSyncDesiredVideoIds(
      ['t1'],
      [],
      [{ spotifyTrackId: 't1', videoId: 'v9', found: false }],
    );

    expect(result).toEqual([]);
  });

  // The drop is deliberately loud: a silently-dropped track leaves needsResync stuck on forever.
  it('warns, with a count, when a track is dropped for a video an earlier track already claimed', () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

    buildSyncDesiredVideoIds(
      ['t1', 't2'],
      [
        { trackId: 't1', videoId: 'dup' },
        { trackId: 't2', videoId: 'dup' },
      ],
      [],
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('already claimed'),
      expect.objectContaining({ droppedCount: 1 }),
    );
    warn.mockRestore();
  });

  it('does not warn when nothing is dropped', () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

    buildSyncDesiredVideoIds(order, [{ trackId: 't1', videoId: 'v1' }], []);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('assertReconcileSafe (delete-safety rail)', () => {
  const items = (n: number): CurrentPlaylistItem[] =>
    Array.from({ length: n }, (_, i) => ({ videoId: `v${i}`, playlistItemId: `pi${i}` }));

  it('throws on the catastrophe shape: empty desired wiping a full playlist', () => {
    // The exact bug: desired came out empty, so every current item is an orphan.
    const current = items(10);
    const ops = computeReconcileOps([], current); // 10 deletes
    expect(() => assertReconcileSafe(ops, [], current.length)).toThrow(ReconcileSafetyError);
  });

  it('throws when a plan would delete more than half of a non-trivial playlist', () => {
    const current = items(10);
    // desired keeps only 3 of the 10 -> 7 deletes (>50%)
    const ops = computeReconcileOps(['v0', 'v1', 'v2'], current);
    expect(() => assertReconcileSafe(ops, ['v0', 'v1', 'v2'], current.length)).toThrow(
      ReconcileSafetyError,
    );
  });

  it('allows a normal re-sync that deletes nothing', () => {
    const current = items(10);
    const desired = current.map((c) => c.videoId); // identical -> 0 ops
    const ops = computeReconcileOps(desired, current);
    expect(() => assertReconcileSafe(ops, desired, current.length)).not.toThrow();
  });

  it('allows removing a few tracks (under the threshold)', () => {
    const current = items(10);
    const desired = current.slice(0, 8).map((c) => c.videoId); // 2 deletes (20%)
    const ops = computeReconcileOps(desired, current);
    expect(() => assertReconcileSafe(ops, desired, current.length)).not.toThrow();
  });

  it('does not trip on tiny playlists', () => {
    const current = items(2);
    const ops = computeReconcileOps([], current); // delete both, but current < min
    expect(() => assertReconcileSafe(ops, [], current.length)).not.toThrow();
  });

  // The minimum is inclusive at 3: two items is "tiny" and exempt, three is not.
  it('does guard a playlist of exactly the minimum size (3)', () => {
    const current = items(3);
    const ops = computeReconcileOps(['v0'], current); // keep 1, delete 2 (67% > 50%)
    expect(() => assertReconcileSafe(ops, ['v0'], current.length)).toThrow(ReconcileSafetyError);
  });

  // The threshold is on DELETES, not on total writes: a heavy reorder (all moves, no deletes) must
  // never be mistaken for a destructive plan.
  it('never trips a plan that deletes nothing, however many moves it makes', () => {
    const current = items(6);
    const desired = [...current].reverse().map((c) => c.videoId); // every video kept, order reversed
    const ops = computeReconcileOps(desired, current);

    expect(ops.some((op) => op.kind === 'delete')).toBe(false);
    expect(ops.some((op) => op.kind === 'move')).toBe(true);
    expect(() => assertReconcileSafe(ops, desired, current.length)).not.toThrow();
  });

  // The boundary is exclusive: deleting EXACTLY half is allowed; only MORE than half trips it.
  it('allows a plan that deletes exactly half', () => {
    const current = items(4);
    const desired = current.slice(0, 2).map((c) => c.videoId); // 2 of 4 deleted = 50%
    const ops = computeReconcileOps(desired, current);

    expect(ops.filter((op) => op.kind === 'delete')).toHaveLength(2);
    expect(() => assertReconcileSafe(ops, desired, current.length)).not.toThrow();
  });
});
