import { YoutubeClient, YtPlaylist, YtPlaylistListResponse } from './youtubeClient';

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
export async function fetchAllYoutubePlaylists(
  youtube: YoutubeClient
): Promise<YtPlaylist[]> {
  const all: YtPlaylist[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const response: YtPlaylistListResponse = await youtube.playlists
      .list({
        part: ['id', 'snippet', 'contentDetails'],
        mine: true,
        maxResults: 50,
        pageToken
      })
      .then(res => res.data);

    if (response.items) {
      all.push(...response.items);
    }
    pageToken = response.nextPageToken || undefined;
  } while (pageToken);

  return all;
}

/**
 * Find the user's YouTube playlist that mirrors the given Spotify playlist name,
 * or null if it hasn't been synced yet. Paginates via fetchAllYoutubePlaylists.
 */
export async function findSyncedYoutubePlaylist(
  youtube: YoutubeClient,
  spotifyPlaylistName: string
): Promise<YtPlaylist | null> {
  const expectedTitle = syncedPlaylistTitle(spotifyPlaylistName);
  const all = await fetchAllYoutubePlaylists(youtube);
  return all.find(playlist => playlist.snippet?.title === expectedTitle) || null;
}
