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

  const episode = (id: string) => ({ track: { id, name: 'An Episode', type: 'episode' } });

  /**
   * A playlist can hold podcast episodes and local files, which are not tracks. They have no video
   * to sync and must not enter the matcher, or they would be classified as unsynced and searched
   * for - spending quota on a video that does not exist for something that is not a song.
   */
  it('update mode: leaves non-track items out of the classification entirely', () => {
    const tracks = [track('t1', 'Song One'), episode('e1'), { track: null }];
    const result = classifyTracksForSync(tracks, existingItems(['v1', 'Song One']), {
      isUpdateMode: true,
      trackLimit: 50,
    });

    expect(result.existingMatchPairs).toEqual([{ trackId: 't1', videoId: 'v1' }]);
    // The episode and the null track are in neither bucket.
    expect(result.syncedTracks).toEqual([tracks[0]]);
    expect(result.unsyncedTracks).toEqual([]);
  });

  // The matcher pairs by content, so a track with no artist must still classify - it falls back to
  // a placeholder artist rather than throwing on artists[0].
  it('update mode: classifies a track whose artist Spotify did not name', () => {
    const noArtist = { track: { id: 't1', name: 'Song One', type: 'track', artists: [] } };
    const result = classifyTracksForSync([noArtist], existingItems(['v1', 'Song One']), {
      isUpdateMode: true,
      trackLimit: 50,
    });

    expect(result.existingMatchPairs).toEqual([{ trackId: 't1', videoId: 'v1' }]);
  });

  /**
   * An existing playlist item with no video id is not a video the matcher can use - reconcile
   * addresses videos by id. Letting it through as a blank-id video would have the matcher consider
   * a candidate that cannot be moved or matched.
   */
  it('update mode: ignores an existing item that carries no video id', () => {
    // The ghost's title matches t2, so if it were NOT skipped the matcher would pair t2 to a
    // videoId of undefined - a pair reconcile cannot address, built from an item that is not a
    // video. The skip is what keeps t2 correctly unsynced.
    const withGhost = new Map<string, YtPlaylistItem>([
      ['v1', { id: 'pi-v1', snippet: { title: 'Song One', resourceId: { videoId: 'v1' } } }],
      ['ghost', { id: 'pi-ghost', snippet: { title: 'Song Two' } }],
    ]);

    const result = classifyTracksForSync(
      [track('t1', 'Song One'), track('t2', 'Song Two')],
      withGhost,
      {
        isUpdateMode: true,
        trackLimit: 50,
      },
    );

    expect(result.existingMatchPairs).toEqual([{ trackId: 't1', videoId: 'v1' }]);
    expect(result.unsyncedTracks).toEqual([track('t2', 'Song Two')]);
  });
});
