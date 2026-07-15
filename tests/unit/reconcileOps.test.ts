/**
 * The reconcile planner, checked by replaying its own plan.
 *
 * Every op here is a real write against the user's playlist at 50 quota units, so both halves
 * matter: the plan has to produce the desired order, and it has to not cost more than it must.
 * These assert against a simulation rather than a hand-written expected list - a plan is only
 * correct if executing it lands the playlist where it should be.
 *
 * The minimum number of "pull one item out and reinsert it" moves to turn one ordering into
 * another is (length - longest increasing subsequence): every item outside that subsequence has to
 * move, and no item inside it needs to. That is the bar the op count is held to.
 */

import { describe, it, expect } from 'vitest';
import { computeReconcileOps, type ReconcileOp } from '@/sync/playlistReconcile';

type Item = { videoId: string; playlistItemId: string };

// The playlist item id has to be unique per row, not per video: a duplicated video is two rows
// YouTube tells apart only by this, and it is what a delete names.
const items = (ids: string[]): Item[] =>
  ids.map((v, i) => ({ videoId: v, playlistItemId: `item${i}-${v}` }));

/** Replays a plan the way YouTube applies it: a move is a remove followed by an insert. */
function apply(current: Item[], ops: ReconcileOp[]): string[] {
  const list = current.map((i) => ({ ...i }));
  for (const op of ops) {
    if (op.kind === 'delete') {
      const at = list.findIndex((i) => i.playlistItemId === op.playlistItemId);
      expect(at, `delete of an item that is not there: ${op.playlistItemId}`).toBeGreaterThan(-1);
      list.splice(at, 1);
    } else if (op.kind === 'insert') {
      list.splice(op.position, 0, { videoId: op.videoId, playlistItemId: `new-${op.videoId}` });
    } else {
      const at = list.findIndex((i) => i.playlistItemId === op.playlistItemId);
      expect(at, `move of an item that is not there: ${op.playlistItemId}`).toBeGreaterThan(-1);
      const [moved] = list.splice(at, 1);
      list.splice(op.position, 0, moved!);
    }
  }
  return list.map((i) => i.videoId);
}

/** Length of the longest strictly increasing subsequence. */
function lisLength(values: number[]): number {
  const tails: number[] = [];
  for (const v of values) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
  }
  return tails.length;
}

/** The fewest moves that can turn `current` into `desired`, for a pure reordering. */
const minimumMoves = (desired: string[], current: string[]) =>
  current.length - lisLength(current.map((v) => desired.indexOf(v)));

/** Every ordering of `list`. */
function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i++) {
    const rest = [...list.slice(0, i), ...list.slice(i + 1)];
    for (const p of permutations(rest)) out.push([list[i]!, ...p]);
  }
  return out;
}

describe('computeReconcileOps: the plan lands the playlist where it should', () => {
  // Exhaustive to five: every ordering against every ordering, which is where an off-by-one in
  // the shifting shows up. A sampled check would not find the one pair that breaks.
  it.each([2, 3, 4, 5])('holds for every ordering of %i items', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `v${i}`);
    const orderings = permutations(ids);

    for (const desired of orderings) {
      for (const current of orderings) {
        const ops = computeReconcileOps(desired, items(current));
        expect(apply(items(current), ops), `desired ${desired} from ${current}`).toEqual(desired);
      }
    }
  });

  it('holds when the playlist is missing videos the order wants', () => {
    const desired = ['a', 'b', 'c', 'd'];

    for (const current of [[], ['a'], ['d'], ['b', 'a'], ['d', 'c'], ['a', 'c'], ['d', 'a']]) {
      const ops = computeReconcileOps(desired, items(current));
      expect(apply(items(current), ops), `from ${current}`).toEqual(desired);
    }
  });

  it('holds when the playlist holds videos the order does not want', () => {
    const desired = ['a', 'b'];

    for (const current of [['x'], ['a', 'x', 'b'], ['x', 'b', 'a'], ['x', 'y', 'a', 'b']]) {
      const ops = computeReconcileOps(desired, items(current));
      expect(apply(items(current), ops), `from ${current}`).toEqual(desired);
    }
  });

  it('drops a duplicated video, keeping the first copy', () => {
    const ops = computeReconcileOps(['a', 'b'], items(['a', 'b', 'a']));

    expect(apply(items(['a', 'b', 'a']), ops)).toEqual(['a', 'b']);
    expect(ops.filter((o) => o.kind === 'delete')).toHaveLength(1);
  });
});

describe('computeReconcileOps: the plan costs no more than it must', () => {
  it.each([2, 3, 4, 5])('makes the fewest possible moves for every ordering of %i', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `v${i}`);
    const orderings = permutations(ids);

    for (const desired of orderings) {
      for (const current of orderings) {
        const ops = computeReconcileOps(desired, items(current));
        const moves = ops.filter((o) => o.kind === 'move').length;
        expect(moves, `desired ${desired} from ${current}`).toBe(minimumMoves(desired, current));
      }
    }
  });

  // The case that cost the most in the wild: the greedy planner rewrote the whole playlist when a
  // single item sat at the wrong end of it.
  it('moves one video, not the whole playlist, when one video is out of place', () => {
    const desired = Array.from({ length: 141 }, (_, i) => `v${i}`);

    const atFront = [desired[140]!, ...desired.slice(0, 140)];
    const atBack = [...desired.slice(1), desired[0]!];

    expect(computeReconcileOps(desired, items(atFront))).toHaveLength(1);
    expect(computeReconcileOps(desired, items(atBack))).toHaveLength(1);
  });

  it('does nothing at all to a playlist already in order', () => {
    const desired = Array.from({ length: 50 }, (_, i) => `v${i}`);

    expect(computeReconcileOps(desired, items(desired))).toEqual([]);
  });

  it('costs one insert per missing video and nothing else', () => {
    const desired = ['a', 'b', 'c', 'd'];

    const ops = computeReconcileOps(desired, items(['a', 'c']));

    expect(ops.filter((o) => o.kind === 'insert')).toHaveLength(2);
    expect(ops.filter((o) => o.kind === 'move')).toHaveLength(0);
  });
});
