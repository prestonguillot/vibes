import {
  YoutubeClient,
  YtPlaylist,
  YtPlaylistItem,
  YtPlaylistItemListResponse,
  YtPlaylistListResponse,
} from './client';

/**
 * Centralized YouTube playlist read helpers. Every route resolves the user's
 * playlists through here so pagination is consistent and YouTube quota usage is
 * accounted for in one place.
 */

/** The title convention for a YouTube playlist synced from a Spotify playlist. */
export function syncedPlaylistTitle(spotifyPlaylistName: string): string {
  return `${spotifyPlaylistName} (from Spotify)`;
}

/**
 * Fetch all of the authenticated user's YouTube playlists, paginating fully.
 * `playlists.list` costs 1 quota unit per page regardless of parts requested.
 */
export async function fetchAllYoutubePlaylists(youtube: YoutubeClient): Promise<YtPlaylist[]> {
  const all: YtPlaylist[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const response: YtPlaylistListResponse = await youtube.playlists
      .list({
        part: ['id', 'snippet', 'contentDetails'],
        mine: true,
        maxResults: 50,
        pageToken,
      })
      .then((res) => res.data);

    if (response.items) {
      all.push(...response.items);
    }
    pageToken = response.nextPageToken || undefined;
  } while (pageToken);

  return all;
}

/** Requested per page. `playlistItems.list` costs 1 quota unit per page, whatever the parts. */
const PLAYLIST_ITEMS_PAGE_SIZE = 50;

/** Called once per page request, so callers can account for the quota a walk spends. */
export type PageCallback = (itemsOnPage: number) => void;

/**
 * The single playlistItems.list pagination loop. Yielding a page at a time lets callers that
 * need every item and callers that stop at the first match share one walk, so neither has to
 * re-implement paging (which is how the four previous copies drifted apart on `part` fields).
 */
async function* playlistItemPages(
  youtube: YoutubeClient,
  playlistId: string,
  parts: string[],
  onPage?: PageCallback,
): AsyncGenerator<YtPlaylistItem[]> {
  let pageToken: string | undefined = undefined;

  do {
    const response: YtPlaylistItemListResponse = await youtube.playlistItems
      .list({
        part: parts,
        playlistId,
        maxResults: PLAYLIST_ITEMS_PAGE_SIZE,
        pageToken,
      })
      .then((res) => res.data);

    const items = response.items || [];
    onPage?.(items.length);
    yield items;

    pageToken = response.nextPageToken || undefined;
  } while (pageToken);
}

/**
 * Fetch every item in a YouTube playlist, paginating fully.
 *
 * @param parts `part` fields to request; the caller pays the same quota either way.
 * @param onPage Invoked per page request, for callers that track quota per call.
 */
export async function fetchAllYoutubePlaylistItems(
  youtube: YoutubeClient,
  playlistId: string,
  parts: string[] = ['id', 'snippet'],
  onPage?: PageCallback,
): Promise<YtPlaylistItem[]> {
  const all: YtPlaylistItem[] = [];

  for await (const page of playlistItemPages(youtube, playlistId, parts, onPage)) {
    all.push(...page);
  }

  return all;
}

/**
 * Walk a YouTube playlist until an item matches, then stop. Unlike fetching everything and
 * filtering, this stops paging at the hit - worth keeping, since a long playlist is many
 * round trips and the caller is on a user-facing path.
 *
 * @returns The match (null if absent) and how many items were looked at getting there.
 */
export async function findYoutubePlaylistItem(
  youtube: YoutubeClient,
  playlistId: string,
  predicate: (item: YtPlaylistItem) => boolean,
  parts: string[] = ['id', 'snippet'],
): Promise<{ item: YtPlaylistItem | null; itemsScanned: number }> {
  let itemsScanned = 0;

  for await (const page of playlistItemPages(youtube, playlistId, parts)) {
    itemsScanned += page.length;
    const item = page.find(predicate);
    if (item) return { item, itemsScanned };
  }

  return { item: null, itemsScanned };
}

/**
 * Find the user's YouTube playlist that mirrors the given Spotify playlist name,
 * or null if it hasn't been synced yet. Paginates via fetchAllYoutubePlaylists.
 */
export async function findSyncedYoutubePlaylist(
  youtube: YoutubeClient,
  spotifyPlaylistName: string,
): Promise<YtPlaylist | null> {
  const expectedTitle = syncedPlaylistTitle(spotifyPlaylistName);
  const all = await fetchAllYoutubePlaylists(youtube);
  return all.find((playlist) => playlist.snippet?.title === expectedTitle) || null;
}
