import { YoutubeClient } from './youtubeClient';
import { Logger } from './logger';
import { youtubeWrite } from './youtubeWrites';

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
 * Pure planner: given the desired ordered video IDs and the playlist's current
 * items, return the ops (in execution order) that make the playlist match.
 *
 * - Deletes any current item whose video isn't desired, and duplicate copies.
 * - Walks the desired order left-to-right, inserting a missing video or moving a
 *   present-but-misplaced one into position. Items already in place are untouched,
 *   so a typical edit (append, insert one, move one) costs a single write.
 */
export function computeReconcileOps(
  desiredVideoIds: string[],
  current: CurrentPlaylistItem[]
): ReconcileOp[] {
  const ops: ReconcileOp[] = [];
  const desiredSet = new Set(desiredVideoIds);

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

  // Pass 2: place each desired video at its index.
  for (let i = 0; i < desiredVideoIds.length; i++) {
    const want = desiredVideoIds[i]!;
    if (working[i]?.videoId === want) continue; // already in place

    const j = working.findIndex((w, idx) => idx >= i && w.videoId === want);
    if (j === -1) {
      ops.push({ kind: 'insert', videoId: want, position: i });
      // The real playlistItemId isn't known until the insert runs; a placeholder
      // keeps positions correct for the rest of the plan.
      working.splice(i, 0, { videoId: want, playlistItemId: '' });
    } else {
      const item = working.splice(j, 1)[0]!;
      ops.push({ kind: 'move', playlistItemId: item.playlistItemId, videoId: want, position: i });
      working.splice(i, 0, item);
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
  newSearchResults: Array<{ spotifyTrackId: string; videoId?: string; found: boolean }>
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
  const used = new Set<string>();
  for (const trackId of orderedSpotifyTrackIds) {
    const videoId = trackToVideo.get(trackId);
    if (videoId && !used.has(videoId)) {
      used.add(videoId);
      desired.push(videoId);
    }
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
  currentCount: number
): void {
  if (currentCount < SAFETY_MIN_CURRENT) return;
  const deletes = ops.filter(op => op.kind === 'delete').length;
  if (deletes / currentCount > MAX_DELETE_FRACTION) {
    throw new ReconcileSafetyError(
      `Refusing reconcile: would delete ${deletes} of ${currentCount} items ` +
      `(desired=${desiredVideoIds.length}) - the desired order looks wrong, not a real removal.`
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
  onProgress?: (done: number, total: number) => void
): Promise<ReconcileResult> {
  const ops = computeReconcileOps(desiredVideoIds, current);
  assertReconcileSafe(ops, desiredVideoIds, current.length);
  const result: ReconcileResult = { inserted: 0, deleted: 0, moved: 0 };

  Logger.info('Reconciling YouTube playlist', {
    youtubePlaylistId,
    desiredCount: desiredVideoIds.length,
    currentCount: current.length,
    ops: ops.length
  });

  let done = 0;
  for (const op of ops) {
    if (op.kind === 'delete') {
      await youtubeWrite('playlistItems.delete', () => youtube.playlistItems.delete({ id: op.playlistItemId }));
      result.deleted++;
    } else if (op.kind === 'insert') {
      await youtubeWrite('playlistItems.insert', () => youtube.playlistItems.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            playlistId: youtubePlaylistId,
            position: op.position,
            resourceId: { kind: 'youtube#video', videoId: op.videoId }
          }
        }
      }));
      result.inserted++;
    } else {
      await youtubeWrite('playlistItems.update', () => youtube.playlistItems.update({
        part: ['snippet'],
        requestBody: {
          id: op.playlistItemId,
          snippet: {
            playlistId: youtubePlaylistId,
            position: op.position,
            resourceId: { kind: 'youtube#video', videoId: op.videoId }
          }
        }
      }));
      result.moved++;
    }
    done++;
    if (onProgress) onProgress(done, ops.length);
  }

  Logger.info('Reconcile complete', { youtubePlaylistId, ...result });
  return result;
}
