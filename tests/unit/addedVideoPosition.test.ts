/**
 * Where a hand-picked video lands (src/sync/addedVideoPosition.ts).
 *
 * When the user replaces a video, the new one must end up beside its track rather than at the end
 * of the playlist. The arithmetic was inline in routes/playlistDetails.ts behind two API fetches,
 * so nothing tested it - and getting it wrong does not throw, it just quietly puts the video in the
 * wrong place, which is what the user sees.
 *
 * optimalTrackMatching is real: the position depends on which tracks it decides have a video, so
 * faking it would be asserting the arithmetic against a matcher that does not exist.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  fetchAllPlaylistItems: vi.fn(),
  fetchAllYoutubePlaylistItems: vi.fn(),
}));

vi.mock('@/spotify/playlistItems', () => ({ fetchAllPlaylistItems: h.fetchAllPlaylistItems }));
vi.mock('@/youtube/playlist', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/playlist')>()),
  fetchAllYoutubePlaylistItems: h.fetchAllYoutubePlaylistItems,
}));

import {
  positionForAddedVideo,
  addedVideoPosition,
  PositionTrack,
  PositionVideo,
} from '@/sync/addedVideoPosition';

const track = (id: string, name: string, artist = 'An Artist'): PositionTrack => ({
  id,
  name,
  artist,
});

/** A video whose title matches `name` well enough for optimalTrackMatching to link it. */
const video = (id: string, name: string, artist = 'An Artist'): PositionVideo => ({
  id,
  title: `${artist} - ${name}`,
  description: '',
  playlistItemId: `item-${id}`,
});

const TRACKS = [track('t1', 'First Song'), track('t2', 'Second Song'), track('t3', 'Third Song')];

describe('the position a replaced video belongs at', () => {
  it('is the front for the first track', () => {
    const videos = [video('v1', 'First Song'), video('v2', 'Second Song')];

    expect(positionForAddedVideo(TRACKS, videos, 't1', 'v1')).toBe(0);
  });

  it('counts the videos ahead of it', () => {
    const videos = [
      video('v1', 'First Song'),
      video('v2', 'Second Song'),
      video('v3', 'Third Song'),
    ];

    expect(positionForAddedVideo(TRACKS, videos, 't3', 'v3')).toBe(2);
  });

  /**
   * The off-by-one the code comments warn about. A track nothing was found for occupies no slot in
   * the YouTube playlist, so counting it would push the video one place too far - past the track it
   * belongs to.
   */
  it('does not count a track that has no video', () => {
    // Nothing in the playlist matches 'Second Song', so t2 holds no slot.
    const videos = [video('v1', 'First Song'), video('v3', 'Third Song')];

    expect(positionForAddedVideo(TRACKS, videos, 't3', 'v3')).toBe(1);
  });

  /**
   * The added video is matched to its own track by id, not by content - the user picked it
   * precisely because matching would not have. If it were counted among the videos ahead, it would
   * claim a slot twice and land one place too far.
   */
  it('does not count the added video itself', () => {
    // v9 is a video the matcher would tie to the FIRST track by content, but the user has just
    // chosen it for the third. It must not also count as first's video.
    const videos = [video('v9', 'First Song'), video('v2', 'Second Song')];

    expect(positionForAddedVideo(TRACKS, videos, 't3', 'v9')).toBe(1);
  });

  it('is nothing to do when the track has left the Spotify playlist', () => {
    const videos = [video('v1', 'First Song')];

    expect(positionForAddedVideo(TRACKS, videos, 'gone', 'v1')).toBeNull();
  });

  it('is the front when the playlist is empty', () => {
    expect(positionForAddedVideo(TRACKS, [], 't1', 'v1')).toBe(0);
  });

  // Every earlier track unmatched means no slots are taken, however many tracks there are.
  it('is the front when nothing ahead of it has a video', () => {
    const videos = [video('v3', 'Third Song')];

    expect(positionForAddedVideo(TRACKS, videos, 't3', 'v3')).toBe(0);
  });
});

/**
 * The half that reads. Both sides arrive as raw API payloads, and what gets dropped on the way in
 * decides the position: a podcast episode counted as a track, or a playlist item kept without a
 * video id, moves the answer.
 */
describe('reading the two playlists', () => {
  const spotifyItem = (id: string, name: string, type = 'track') => ({
    track: { id, name, type, artists: [{ name: 'An Artist' }] },
  });
  const ytItem = (videoId: string, title: string) => ({
    id: `item-${videoId}`,
    snippet: { title, description: '', resourceId: { videoId } },
  });

  const call = () =>
    addedVideoPosition({
      youtube: {} as Parameters<typeof addedVideoPosition>[0]['youtube'],
      youtubePlaylistId: 'PL',
      spotifyAccessToken: 'sp',
      spotifyPlaylistId: 'SP',
      trackId: 't2',
      newVideoId: 'v2',
    });

  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchAllPlaylistItems.mockResolvedValue([
      spotifyItem('t1', 'First Song'),
      spotifyItem('t2', 'Second Song'),
    ]);
    h.fetchAllYoutubePlaylistItems.mockResolvedValue([
      ytItem('v1', 'An Artist - First Song'),
      ytItem('v2', 'An Artist - Second Song'),
    ]);
  });

  it('asks YouTube only for the parts it reads', async () => {
    await call();

    expect(h.fetchAllYoutubePlaylistItems).toHaveBeenCalledWith({}, 'PL', ['id', 'snippet']);
  });

  it('counts the video ahead of the track', async () => {
    expect(await call()).toBe(1);
  });

  // A podcast episode is not a track and holds no slot in the YouTube playlist.
  it('ignores Spotify items that are not tracks', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      spotifyItem('e1', 'An Episode', 'episode'),
      spotifyItem('t1', 'First Song'),
      spotifyItem('t2', 'Second Song'),
    ]);

    expect(await call()).toBe(1);
  });

  it('ignores a Spotify item with no track at all', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      { track: null },
      spotifyItem('t1', 'First Song'),
      spotifyItem('t2', 'Second Song'),
    ]);

    expect(await call()).toBe(1);
  });

  // An item with no video id is not a video; counting it would claim a slot nothing occupies.
  it('ignores a playlist item with no video id', async () => {
    h.fetchAllYoutubePlaylistItems.mockResolvedValue([
      { id: 'item-broken', snippet: { title: 'no resourceId', description: '' } },
      ytItem('v2', 'An Artist - Second Song'),
    ]);

    expect(await call()).toBe(0);
  });

  it('still matches a track whose artist Spotify did not name', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      { track: { id: 't1', name: 'First Song', type: 'track', artists: [] } },
      spotifyItem('t2', 'Second Song'),
    ]);

    await expect(call()).resolves.not.toBeNull();
  });
});
