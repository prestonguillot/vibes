/**
 * Unit tests for the extracted STEP 2 classifier (classifyTracksForSync):
 * create-mode passthrough, update-mode matching into synced/unsynced, the
 * existing match pairs it records, and the trackLimit cap.
 */

import { describe, it, expect } from 'vitest';
import { YtPlaylistItem } from '../../src/youtube/client';
import { classifyTracksForSync } from '../../src/sync/trackClassification';

const track = (id: string, name: string) => ({
  track: { id, name, type: 'track', artists: [{ name: 'Artist' }] },
});

const existingItems = (...pairs: Array<[string, string]>): Map<string, YtPlaylistItem> => {
  const map = new Map<string, YtPlaylistItem>();
  for (const [videoId, title] of pairs) {
    map.set(videoId, { id: `pi-${videoId}`, snippet: { title, resourceId: { videoId } } });
  }
  return map;
};

describe('classifyTracksForSync', () => {
  it('create mode: takes tracks from the top up to trackLimit, no matching', () => {
    const tracks = [track('t1', 'One'), track('t2', 'Two'), track('t3', 'Three')];
    const result = classifyTracksForSync(tracks, new Map(), { isUpdateMode: false, trackLimit: 2 });
    expect(result.tracksToSearch).toEqual([tracks[0], tracks[1]]);
    expect(result.syncedTracks).toEqual([]);
    expect(result.unsyncedTracks).toEqual([]);
    expect(result.existingMatchPairs).toEqual([]);
  });

  it('update mode, all matched: nothing to search, records all match pairs', () => {
    const tracks = [track('t1', 'Song One'), track('t2', 'Song Two')];
    const existing = existingItems(['v1', 'Song One'], ['v2', 'Song Two']);
    const result = classifyTracksForSync(tracks, existing, { isUpdateMode: true, trackLimit: 50 });

    expect(result.tracksToSearch).toEqual([]);
    expect(result.unsyncedTracks).toEqual([]);
    expect(result.existingMatchPairs).toEqual([
      { trackId: 't1', videoId: 'v1' },
      { trackId: 't2', videoId: 'v2' },
    ]);
  });

  it('update mode, partial: unmatched tracks become unsynced and need searching', () => {
    const tracks = [track('t1', 'Song One'), track('t2', 'Song Two')];
    const existing = existingItems(['v1', 'Song One']); // only t1 has a video
    const result = classifyTracksForSync(tracks, existing, { isUpdateMode: true, trackLimit: 50 });

    expect(result.existingMatchPairs).toEqual([{ trackId: 't1', videoId: 'v1' }]);
    expect(result.unsyncedTracks).toEqual([tracks[1]]);
    expect(result.tracksToSearch).toEqual([tracks[1]]);
  });

  it('update mode: caps tracksToSearch at trackLimit but keeps the full unsynced list', () => {
    const tracks = [track('t1', 'A'), track('t2', 'B'), track('t3', 'C')];
    const result = classifyTracksForSync(tracks, new Map(), { isUpdateMode: true, trackLimit: 2 });
    expect(result.unsyncedTracks).toHaveLength(3);
    expect(result.tracksToSearch).toHaveLength(2);
  });
});
