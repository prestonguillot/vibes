import { YoutubeClient } from '../youtube/client';
import { Logger } from '../lib/logger';
import { youtubeWrite } from '../youtube/writes';

/**
 * Reconciles a YouTube playlist to an explicit desired order of video IDs.
 *
 * Unlike the older reorder path, this does NOT re-derive matches by content - it
 * trusts the caller's desired order, so a manually-picked video that doesn't
 * look like its track still lands in the right place. It computes the minimal
 * set of writes (delete orphans, insert missing at position, move out-of-place
 * items) so YouTube quota spent on 50-unit writes stays small.
 */

export interface CurrentPlaylistItem {
  videoId: string;
  playlistItemId: string;
}

export type ReconcileOp =
  | { kind: 'delete'; playlistItemId: string; videoId: string }
  | { kind: 'insert'; videoId: string; position: number }
  | { kind: 'move'; playlistItemId: string; videoId: string; position: number };

/**
 * Indexes of the leftmost longest strictly increasing subsequence of `values`.
 *
 * Which of several equally long subsequences is picked decides the cost, not just the shape: the
 * leftmost one leaves every other video needing a single move, where another choice can leave one
 * of them in the way of a video that must not move, and paying for a second move to get out of it.
 */
function longestIncreasingSubsequence(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];

  // longest[i] = length of the longest increasing subsequence starting at i.
  const longest = new Array<number>(n).fill(1);
  for (let i = n - 2; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) {
      if (values[j]! > values[i]! && longest[j]! + 1 > longest[i]!) longest[i] = longest[j]! + 1;
    }
  }

  const out: number[] = [];
  let wanted = Math.max(...longest);
  let last = -Infinity;
  for (let i = 0; i < n && wanted > 0; i++) {
    if (longest[i] === wanted && values[i]! > last) {
      out.push(i);
      last = values[i]!;
      wanted--;
    }
  }
  return out;
}

/**
 * Pure planner: given the desired ordered video IDs and the playlist's current
 * items, return the ops (in execution order) that make the playlist match.
 *
 * - Deletes any current item whose video isn't desired, and duplicate copies.
 * - Moves only the videos that have to move, and inserts the ones that are missing.
 *
 * Every op is a write costing 50 of a 10,000-unit daily quota, so the count is the whole point.
 * The fewest moves that can reorder a list is (length - longest increasing subsequence): the videos
 * along that subsequence are already in the right order relative to each other and only need the
 * rest moved out from between them. Placing each desired video in turn instead - the obvious
 * reading of "make it match" - costs one move per video from the first one out of place: a single
 * video at the wrong end of a 141-video playlist cost 140 writes, or 7,000 units, where 1 would do.
 */
export function computeReconcileOps(
  desiredVideoIds: string[],
  current: CurrentPlaylistItem[],
): ReconcileOp[] {
  const ops: ReconcileOp[] = [];
  const desiredSet = new Set(desiredVideoIds);
  const desiredIndexOf = new Map(desiredVideoIds.map((videoId, i) => [videoId, i]));

  // Pass 1: drop orphans and duplicate occurrences, keeping current order.
  const seen = new Set<string>();
  const working: CurrentPlaylistItem[] = [];
  for (const item of current) {
    if (!desiredSet.has(item.videoId) || seen.has(item.videoId)) {
      ops.push({ kind: 'delete', playlistItemId: item.playlistItemId, videoId: item.videoId });
    } else {
      seen.add(item.videoId);
      working.push(item);
    }
  }

  // Pass 2: the survivors that are already in order relative to each other. They are carried into
  // place by the moves around them and are never written.
  const stays = new Set(
    longestIncreasingSubsequence(working.map((w) => desiredIndexOf.get(w.videoId)!)).map(
      (i) => working[i]!,
    ),
  );

  // Pass 3: everything else gets placed, in the order it appears in the desired list, each landing
  // directly behind the video it belongs behind.
  //
  // The landing index is not the video's final index: videos still waiting to be placed are sitting
  // in between, and each will shift this one left when it leaves. Anchoring to the predecessor -
  // already settled, because the desired order is walked front to back - is what keeps a single
  // move per video. Aiming at the final index instead lands correctly only until the next move
  // pulls something out from in front of it, and then costs a second move to fix.
  const byVideoId = new Map(working.map((item) => [item.videoId, item]));
  const toPlace = desiredVideoIds
    .map((videoId, target) => ({ videoId, target, item: byVideoId.get(videoId) }))
    .filter(({ item }) => !item || !stays.has(item));

  for (const { videoId, target, item } of toPlace) {
    if (item) working.splice(working.indexOf(item), 1);

    const predecessor =
      target === 0 ? -1 : working.findIndex((w) => w.videoId === desiredVideoIds[target - 1]);
    const position = predecessor + 1;

    if (item) {
      ops.push({ kind: 'move', playlistItemId: item.playlistItemId, videoId, position });
      working.splice(position, 0, item);
    } else {
      ops.push({ kind: 'insert', videoId, position });
      // The real playlistItemId isn't known until the insert runs; a placeholder
      // keeps positions correct for the rest of the plan.
      working.splice(position, 0, { videoId, playlistItemId: '' });
    }
  }

  return ops;
}

/**
 * Build the desired ordered list of video IDs for a sync.
 *
 * Walks the Spotify tracks in playlist order and emits each track's chosen video:
 * a freshly-searched video takes precedence, otherwise the video it's already
 * matched to. Tracks with no video are skipped, and a video is emitted at most
 * once (first track wins) so reconcile never tries to add a duplicate.
 */
export function buildSyncDesiredVideoIds(
  orderedSpotifyTrackIds: string[],
  existingMatches: Array<{ trackId: string; videoId: string }>,
  newSearchResults: Array<{ spotifyTrackId: string; videoId?: string; found: boolean }>,
): string[] {
  const trackToVideo = new Map<string, string>();
  for (const m of existingMatches) {
    if (m.trackId && m.videoId) trackToVideo.set(m.trackId, m.videoId);
  }
  // New searches override an existing match for the same track.
  for (const r of newSearchResults) {
    if (r.found && r.videoId && r.spotifyTrackId) trackToVideo.set(r.spotifyTrackId, r.videoId);
  }

  const desired: string[] = [];
  // videoId -> the track that claimed it, so a collision can name both sides.
  const claimedBy = new Map<string, string>();
  const dropped: Array<{ trackId: string; videoId: string; alreadyClaimedBy: string }> = [];

  for (const trackId of orderedSpotifyTrackIds) {
    const videoId = trackToVideo.get(trackId);
    if (!videoId) continue;

    const owner = claimedBy.get(videoId);
    if (owner) {
      // "First track wins" keeps reconcile from inserting a duplicate - but it means this track
      // can NEVER sync, and a silent drop makes the sync report success having done nothing
      // (desired == current -> 0 ops) and leaves needsResync stuck on forever. Say so.
      dropped.push({ trackId, videoId, alreadyClaimedBy: owner });
      continue;
    }
    claimedBy.set(videoId, trackId);
    desired.push(videoId);
  }

  if (dropped.length > 0) {
    Logger.warn(
      'Dropped tracks from the desired order: their video is already claimed by an earlier track',
      { droppedCount: dropped.length, dropped: dropped.slice(0, 10) },
    );
  }

  return desired;
}

export interface ReconcileResult {
  inserted: number;
  deleted: number;
  moved: number;
}

/** Thrown when a reconcile plan looks destructive enough to be a bug, not intent. */
export class ReconcileSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconcileSafetyError';
  }
}

// A correct desired order overlaps heavily with the current playlist, so a plan
// that deletes most of it almost always means the desired order was computed
// wrong (as happened when existing matches came back empty and every item looked
// like an orphan). Bail before any writes rather than wipe the user's data.
const MAX_DELETE_FRACTION = 0.5;
const SAFETY_MIN_CURRENT = 3;

/**
 * Throws ReconcileSafetyError if the plan would delete more than half of a
 * non-trivial playlist while the desired list is non-empty. Pure, so it can be
 * unit-tested directly.
 */
export function assertReconcileSafe(
  ops: ReconcileOp[],
  desiredVideoIds: string[],
  currentCount: number,
): void {
  if (currentCount < SAFETY_MIN_CURRENT) return;
  const deletes = ops.filter((op) => op.kind === 'delete').length;
  if (deletes / currentCount > MAX_DELETE_FRACTION) {
    throw new ReconcileSafetyError(
      `Refusing reconcile: would delete ${deletes} of ${currentCount} items ` +
        `(desired=${desiredVideoIds.length}) - the desired order looks wrong, not a real removal.`,
    );
  }
}

/**
 * Execute a reconcile against YouTube. All writes go through youtubeWrite, so the
 * circuit breaker stops the run early if the quota is exhausted.
 */
export async function reconcilePlaylist(
  youtube: YoutubeClient,
  youtubePlaylistId: string,
  desiredVideoIds: string[],
  current: CurrentPlaylistItem[],
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<ReconcileResult> {
  const ops = computeReconcileOps(desiredVideoIds, current);
  assertReconcileSafe(ops, desiredVideoIds, current.length);
  const result: ReconcileResult = { inserted: 0, deleted: 0, moved: 0 };

  Logger.info('Reconciling YouTube playlist', {
    youtubePlaylistId,
    desiredCount: desiredVideoIds.length,
    currentCount: current.length,
    ops: ops.length,
  });

  let done = 0;
  for (const op of ops) {
    if (op.kind === 'delete') {
      await youtubeWrite('playlistItems.delete', () =>
        youtube.playlistItems.delete({ id: op.playlistItemId }),
      );
      result.deleted++;
    } else if (op.kind === 'insert') {
      await youtubeWrite('playlistItems.insert', () =>
        youtube.playlistItems.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              playlistId: youtubePlaylistId,
              position: op.position,
              resourceId: { kind: 'youtube#video', videoId: op.videoId },
            },
          },
        }),
      );
      result.inserted++;
    } else {
      await youtubeWrite('playlistItems.update', () =>
        youtube.playlistItems.update({
          part: ['snippet'],
          requestBody: {
            id: op.playlistItemId,
            snippet: {
              playlistId: youtubePlaylistId,
              position: op.position,
              resourceId: { kind: 'youtube#video', videoId: op.videoId },
            },
          },
        }),
      );
      result.moved++;
    }
    done++;
    if (onProgress) await onProgress(done, ops.length);
  }

  Logger.info('Reconcile complete', { youtubePlaylistId, ...result });
  return result;
}
