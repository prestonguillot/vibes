/**
 * Tests for how fetchPlaylistDetails MAPS a playlist into what the UI renders.
 *
 * The mapped fields ARE the UI - the thumbnail, the link, and the channel that decides the
 * official-video bonus. The module's other tests assert scalars (needsResync, totalTracks,
 * tracks.length); the mapping itself is pinned here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getPlaylist: vi.fn(), fetchAllPlaylistItems: vi.fn() }));
vi.mock('../../src/spotify/client', async (importActual) => ({
  ...(await importActual<typeof import('../../src/spotify/client')>()),
  getPlaylist: h.getPlaylist,
}));
vi.mock('../../src/spotify/playlistItems', () => ({
  fetchAllPlaylistItems: h.fetchAllPlaylistItems,
}));

import { fetchPlaylistDetails } from '../../src/sync/playlistDetailsService';

const spotifyTrack = (over: Record<string, unknown> = {}) => ({
  track: {
    id: 't1',
    name: 'Creep',
    type: 'track',
    artists: [{ name: 'Radiohead' }],
    album: { name: 'Pablo Honey', images: [{ url: 'https://art/creep.jpg' }] },
    ...over,
  },
});

/** A YouTube client serving one page of playlist items with the given snippets. */
const youtubeWith = (snippets: Array<Record<string, unknown>>) =>
  ({
    playlistItems: {
      list: vi.fn(async () => ({
        data: { items: snippets.map((snippet, i) => ({ id: `pi${i}`, snippet })) },
      })),
    },
  }) as never;

const creepSnippet = (over: Record<string, unknown> = {}) => ({
  title: 'Radiohead - Creep',
  description: 'the official video',
  resourceId: { videoId: 'vid1' },
  videoOwnerChannelTitle: 'RadioheadVEVO',
  channelTitle: 'Some Playlist Owner',
  thumbnails: {
    medium: { url: 'https://i.ytimg/medium.jpg' },
    default: { url: 'https://i.ytimg/default.jpg' },
  },
  publishedAt: '2007-11-06T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.getPlaylist.mockResolvedValue({
    id: 'pl1',
    name: 'My Playlist',
    ownerId: 'me',
    trackTotal: 1,
    spotifyUrl: 'https://open.spotify.com/playlist/pl1',
  });
});

describe('fetchPlaylistDetails: the merged track it hands the UI', () => {
  it('maps a matched track to its Spotify data and YouTube link', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([creepSnippet()]),
      'pl1',
      'PL1',
    );

    const track = details.tracks[0]!;
    expect(track.linked).toBe(true);
    // Asserted whole: a field that silently goes missing is a broken row in the UI.
    expect(track.youtube).toEqual({
      id: 'vid1',
      title: 'Radiohead - Creep',
      description: 'the official video',
      thumbnail: 'https://img.youtube.com/vi/vid1/mqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=vid1',
    });
  });

  it('leaves an unmatched track linked:false with no youtube side', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([
        creepSnippet({ title: 'Totally Unrelated Cooking Show', resourceId: { videoId: 'other' } }),
      ]),
      'pl1',
      'PL1',
    );

    expect(details.tracks[0]!.linked).toBe(false);
    expect(details.tracks[0]!.youtube).toBeNull();
    expect(details.linkedCount).toBe(0);
  });

  it('carries the match score through for a linked track', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([creepSnippet()]),
      'pl1',
      'PL1',
    );

    expect(details.tracks[0]!.matchScore?.totalScore).toBeGreaterThan(0.4);
    expect(details.tracks[0]!.matchScore?.components.coreMatch).toBe(0.6);
    expect(details.tracks[0]!.matchScore?.stars).toBeGreaterThan(0);
  });

  it('reports an orphan video with no spotify side', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([
        creepSnippet(),
        creepSnippet({ title: 'Unrelated', resourceId: { videoId: 'orphan' } }),
      ]),
      'pl1',
      'PL1',
    );

    const orphan = details.tracks.find((t) => t.spotify === null)!;
    expect(orphan.linked).toBe(false);
    expect(orphan.youtube).toEqual({
      id: 'orphan',
      title: 'Unrelated',
      description: 'the official video',
      thumbnail: 'https://img.youtube.com/vi/orphan/mqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=orphan',
    });
  });
});

describe('fetchPlaylistDetails: reading the YouTube snippet', () => {
  // The comment in the source is emphatic about this: snippet.channelTitle on a playlist item is
  // the PLAYLIST OWNER's channel, not the uploader's. Using it made every match miss the
  // official-video bonus. Nothing pinned it.
  it('takes the channel from videoOwnerChannelTitle, not channelTitle', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([
        creepSnippet({
          title: 'Radiohead - Creep (Official Video)',
          videoOwnerChannelTitle: 'RadioheadVEVO',
          channelTitle: 'Some Playlist Owner',
        }),
      ]),
      'pl1',
      'PL1',
    );

    // The official-video bonus only lands if the uploader's channel was used.
    expect(details.tracks[0]!.matchScore?.components.officialVideo).toBe(0.3);
  });

  it('falls back to channelTitle when there is no videoOwnerChannelTitle', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([
        creepSnippet({
          title: 'Radiohead - Creep (Official Video)',
          videoOwnerChannelTitle: undefined,
          channelTitle: 'RadioheadVEVO',
        }),
      ]),
      'pl1',
      'PL1',
    );

    expect(details.tracks[0]!.matchScore?.components.officialVideo).toBe(0.3);
  });

  it('still matches when the snippet has no channel at all', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([creepSnippet({ videoOwnerChannelTitle: undefined, channelTitle: undefined })]),
      'pl1',
      'PL1',
    );

    expect(details.tracks[0]!.linked).toBe(true);
    expect(details.tracks[0]!.matchScore?.components.officialVideo).toBeUndefined();
  });

  it('survives a snippet with no title or description', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([{ resourceId: { videoId: 'vid1' } }]),
      'pl1',
      'PL1',
    );

    // An unreadable video must not match anything, and must not throw.
    expect(details.tracks[0]!.linked).toBe(false);
    expect(details.totalTracks).toBe(1);
  });
});

describe('fetchPlaylistDetails: counts', () => {
  it('counts only Spotify tracks in totalTracks, orphans excluded', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([
        creepSnippet(),
        creepSnippet({ title: 'Orphan', resourceId: { videoId: 'x' } }),
      ]),
      'pl1',
      'PL1',
    );

    expect(details.totalTracks).toBe(1);
    expect(details.linkedCount).toBe(1);
    expect(details.tracks).toHaveLength(2); // 1 track + 1 orphan row
  });

  it('reports no YouTube playlist when it holds no items', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails('token', youtubeWith([]), 'pl1', 'PL1');

    expect(details.hasYoutubePlaylist).toBe(false);
    expect(details.linkedCount).toBe(0);
  });

  it('reports no YouTube playlist when YouTube is not connected at all', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails('token', null, 'pl1', undefined);

    expect(details.hasYoutubePlaylist).toBe(false);
    expect(details.tracks[0]!.youtube).toBeNull();
  });
});
