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
import { Logger } from '../../src/lib/logger';

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

/** A YouTube client serving raw playlist items verbatim - so a test can omit `snippet` entirely. */
const youtubeRaw = (items: Array<Record<string, unknown>>) =>
  ({
    playlistItems: { list: vi.fn(async () => ({ data: { items } })) },
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

describe('fetchPlaylistDetails: degenerate track fields', () => {
  it('fills in defaults when a track has no artist, album, art, or preview', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      spotifyTrack({
        id: 't1',
        name: 'Nameless',
        artists: [], // no artist -> 'Unknown Artist' (and artists[0] is undefined, not a throw)
        album: undefined, // no album -> 'Unknown Album', no art
        duration_ms: 1000,
        external_urls: { spotify: 'https://open.spotify.com/track/t1' },
        preview_url: null,
      }),
    ]);

    const details = await fetchPlaylistDetails('token', null, 'pl1', undefined);

    // Asserted whole - every default in one place.
    expect(details.tracks[0]!.spotify).toEqual({
      id: 't1',
      name: 'Nameless',
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      albumArt: undefined,
      duration_ms: 1000,
      external_urls: { spotify: 'https://open.spotify.com/track/t1' },
      preview_url: null,
    });
  });

  it('carries a present preview_url through unchanged', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([
      spotifyTrack({ preview_url: 'https://preview/t1.mp3' }),
    ]);

    const details = await fetchPlaylistDetails('token', null, 'pl1', undefined);

    expect(details.tracks[0]!.spotify!.preview_url).toBe('https://preview/t1.mp3');
  });
});

describe('fetchPlaylistDetails: unavailable-track accounting', () => {
  it('warns, with counts, when the playlist reports more tracks than are usable', async () => {
    // trackTotal 3, but two items have no track (removed/local) - so 2 are unavailable.
    h.getPlaylist.mockResolvedValue({
      id: 'pl1',
      name: 'My Playlist',
      ownerId: 'me',
      trackTotal: 3,
      spotifyUrl: 'https://open.spotify.com/playlist/pl1',
    });
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack(), { track: null }, { track: null }]);
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

    await fetchPlaylistDetails('token', null, 'pl1', undefined);

    expect(warn).toHaveBeenCalledWith(
      'Playlist contains unavailable tracks',
      expect.objectContaining({
        playlistId: 'pl1',
        totalTracks: 3,
        availableTracks: 1,
        unavailableTracks: 2,
      }),
    );
  });

  it('does not warn when every reported track is available', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]); // trackTotal defaults to 1
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

    await fetchPlaylistDetails('token', null, 'pl1', undefined);

    expect(warn).not.toHaveBeenCalledWith(
      'Playlist contains unavailable tracks',
      expect.anything(),
    );
  });
});

describe('fetchPlaylistDetails: reading a broken YouTube item', () => {
  it('requests the id and snippet parts from YouTube', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);
    const list = vi.fn(async (_opts: { part: string[] }) => ({ data: { items: [] } }));

    await fetchPlaylistDetails('token', { playlistItems: { list } } as never, 'pl1', 'PL1');

    expect(list).toHaveBeenCalled();
    expect(list.mock.calls[0]![0].part).toEqual(['id', 'snippet']);
  });

  it('does not throw on a playlist item with no snippet at all', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails('token', youtubeRaw([{ id: 'pi0' }]), 'pl1', 'PL1');

    // A snippet-less item becomes an empty video: present (so hasYoutubePlaylist), but unmatchable.
    expect(details.hasYoutubePlaylist).toBe(true);
    expect(details.tracks[0]!.linked).toBe(false);
  });

  it('does not throw on a snippet with no resourceId', async () => {
    h.fetchAllPlaylistItems.mockResolvedValue([spotifyTrack()]);

    const details = await fetchPlaylistDetails(
      'token',
      youtubeWith([{ title: 'Totally Unrelated Cooking Show' }]), // snippet present, resourceId absent
      'pl1',
      'PL1',
    );

    expect(details.tracks[0]!.linked).toBe(false);
    expect(details.totalTracks).toBe(1);
  });
});
