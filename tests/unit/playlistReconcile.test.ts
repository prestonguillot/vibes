/**
 * Unit tests for the reconcile planner (computeReconcileOps): given a desired
 * order of video IDs and the playlist's current items, it returns the minimal
 * delete/insert/move ops to make the playlist match - honoring the explicit
 * desired order without any content matching.
 */

import { describe, it, expect } from 'vitest';
import { computeReconcileOps, buildSyncDesiredVideoIds, CurrentPlaylistItem } from '../../src/utils/playlistReconcile';

const ci = (...videoIds: string[]): CurrentPlaylistItem[] =>
  videoIds.map(videoId => ({ videoId, playlistItemId: `pi-${videoId}` }));

describe('computeReconcileOps', () => {
  it('returns no ops when already in the desired order', () => {
    expect(computeReconcileOps(['a', 'b', 'c'], ci('a', 'b', 'c'))).toEqual([]);
  });

  it('handles empty playlist and empty desired', () => {
    expect(computeReconcileOps([], [])).toEqual([]);
  });

  it('appends a missing video at the end', () => {
    expect(computeReconcileOps(['a', 'b', 'c'], ci('a', 'b'))).toEqual([
      { kind: 'insert', videoId: 'c', position: 2 }
    ]);
  });

  it('inserts a missing video in the middle', () => {
    expect(computeReconcileOps(['a', 'b', 'c'], ci('a', 'c'))).toEqual([
      { kind: 'insert', videoId: 'b', position: 1 }
    ]);
  });

  it('deletes an orphan video not in the desired order', () => {
    expect(computeReconcileOps(['a', 'b'], ci('a', 'x', 'b'))).toEqual([
      { kind: 'delete', playlistItemId: 'pi-x', videoId: 'x' }
    ]);
  });

  it('deletes duplicate occurrences of a desired video', () => {
    expect(computeReconcileOps(['a', 'b'], ci('a', 'a', 'b'))).toEqual([
      { kind: 'delete', playlistItemId: 'pi-a', videoId: 'a' }
    ]);
  });

  it('moves a manually-added video from the end into its correct slot (the bug case)', () => {
    // 'NEW' was appended by the manual-add flow; desired wants it at index 1.
    expect(computeReconcileOps(['a', 'NEW', 'b'], ci('a', 'b', 'NEW'))).toEqual([
      { kind: 'move', playlistItemId: 'pi-NEW', videoId: 'NEW', position: 1 }
    ]);
  });

  it('replaces a video: deletes the old, inserts the new in place', () => {
    expect(computeReconcileOps(['a', 'NEW', 'c'], ci('a', 'OLD', 'c'))).toEqual([
      { kind: 'delete', playlistItemId: 'pi-OLD', videoId: 'OLD' },
      { kind: 'insert', videoId: 'NEW', position: 1 }
    ]);
  });

  it('reorders a reversed playlist with moves only', () => {
    const ops = computeReconcileOps(['c', 'b', 'a'], ci('a', 'b', 'c'));
    expect(ops).toEqual([
      { kind: 'move', playlistItemId: 'pi-c', videoId: 'c', position: 0 },
      { kind: 'move', playlistItemId: 'pi-b', videoId: 'b', position: 1 }
    ]);
  });

  it('builds an empty playlist entirely from inserts', () => {
    expect(computeReconcileOps(['a', 'b'], [])).toEqual([
      { kind: 'insert', videoId: 'a', position: 0 },
      { kind: 'insert', videoId: 'b', position: 1 }
    ]);
  });

  it('removes everything when desired is empty', () => {
    expect(computeReconcileOps([], ci('a', 'b'))).toEqual([
      { kind: 'delete', playlistItemId: 'pi-a', videoId: 'a' },
      { kind: 'delete', playlistItemId: 'pi-b', videoId: 'b' }
    ]);
  });

  it('combines delete, insert and move in one plan', () => {
    // current: a, ORPHAN, c, b   desired: a, b, c
    const ops = computeReconcileOps(['a', 'b', 'c'], ci('a', 'ORPHAN', 'c', 'b'));
    expect(ops).toEqual([
      { kind: 'delete', playlistItemId: 'pi-ORPHAN', videoId: 'ORPHAN' },
      { kind: 'move', playlistItemId: 'pi-b', videoId: 'b', position: 1 }
    ]);
  });
});

describe('buildSyncDesiredVideoIds', () => {
  const order = ['t1', 't2', 't3'];

  it('emits videos in Spotify track order', () => {
    const result = buildSyncDesiredVideoIds(
      order,
      [{ trackId: 't1', videoId: 'v1' }, { trackId: 't2', videoId: 'v2' }, { trackId: 't3', videoId: 'v3' }],
      []
    );
    expect(result).toEqual(['v1', 'v2', 'v3']);
  });

  it('combines existing matches with new search results', () => {
    // t1/t3 already matched; t2 newly searched.
    const result = buildSyncDesiredVideoIds(
      order,
      [{ trackId: 't1', videoId: 'v1' }, { trackId: 't3', videoId: 'v3' }],
      [{ spotifyTrackId: 't2', videoId: 'v2', found: true }]
    );
    expect(result).toEqual(['v1', 'v2', 'v3']);
  });

  it('skips tracks with no video (unfound / unmatched)', () => {
    const result = buildSyncDesiredVideoIds(
      order,
      [{ trackId: 't1', videoId: 'v1' }],
      [{ spotifyTrackId: 't3', videoId: 'v3', found: true }]
      // t2 has neither -> skipped, but order of the rest is preserved
    );
    expect(result).toEqual(['v1', 'v3']);
  });

  it('ignores unfound search results', () => {
    const result = buildSyncDesiredVideoIds(
      order,
      [],
      [{ spotifyTrackId: 't1', videoId: undefined, found: false }, { spotifyTrackId: 't2', videoId: 'v2', found: true }]
    );
    expect(result).toEqual(['v2']);
  });

  it('lets a new search override an existing match for the same track', () => {
    const result = buildSyncDesiredVideoIds(
      ['t1'],
      [{ trackId: 't1', videoId: 'old' }],
      [{ spotifyTrackId: 't1', videoId: 'new', found: true }]
    );
    expect(result).toEqual(['new']);
  });

  it('emits a video at most once even if two tracks map to it', () => {
    const result = buildSyncDesiredVideoIds(
      ['t1', 't2'],
      [{ trackId: 't1', videoId: 'dup' }, { trackId: 't2', videoId: 'dup' }],
      []
    );
    expect(result).toEqual(['dup']);
  });
});
