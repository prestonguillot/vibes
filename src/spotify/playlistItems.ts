import { Logger } from '../lib/logger';

interface SpotifyTrackObject {
  id?: string;
  name?: string;
  type?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string }> };
  duration_ms?: number;
  external_urls?: { spotify?: string };
  preview_url?: string | null;
}

/**
 * A normalized Spotify playlist item. `track` is populated from the API's new
 * `item` field (the legacy `item.track` field is deprecated/empty after the
 * Feb 2026 migration). `track` may be null for removed/unavailable entries
 * (callers must null-check before accessing it).
 */
export interface SpotifyPlaylistItem {
  track: SpotifyTrackObject | null;
}

/**
 * Raw item as returned by GET /v1/playlists/{id}/items. Track/episode data lives
 * under `item`; `track` is the deprecated legacy field.
 */
interface RawSpotifyPlaylistItem {
  item?: SpotifyTrackObject | null;
  track?: SpotifyTrackObject | null;
}

interface SpotifyItemsResponse {
  items?: RawSpotifyPlaylistItem[];
  total?: number;
  next?: string | null;
}

/**
 * Fetch all items (tracks) of a Spotify playlist via GET /v1/playlists/{id}/items,
 * paginating fully.
 *
 * This replaces spotify-web-api-node's getPlaylistTracks(), which calls the
 * /v1/playlists/{id}/tracks endpoint that Spotify removed in its February 2026
 * Web API migration (it now returns 403). The library is unmaintained and has
 * no /items support, so we call the endpoint directly. The /items endpoint
 * requires a user access token.
 *
 * @param accessToken A valid Spotify user access token.
 * @param playlistId Spotify playlist ID.
 * @returns All playlist items in order.
 */
export async function fetchAllPlaylistItems(
  accessToken: string,
  playlistId: string,
): Promise<SpotifyPlaylistItem[]> {
  const all: SpotifyPlaylistItem[] = [];
  const limit = 50;
  let offset = 0;

  while (true) {
    const url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=${limit}&offset=${offset}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const error = new Error(
        `Spotify playlist items request failed: HTTP ${response.status} ${response.statusText}`,
      ) as Error & { statusCode?: number; body?: string };
      // Mirror spotify-web-api-node's error shape so existing handlers that read
      // statusCode continue to work.
      error.statusCode = response.status;
      error.body = bodyText;
      throw error;
    }

    const data = (await response.json()) as SpotifyItemsResponse;
    const rawItems = data.items || [];
    // Normalize the Feb 2026 schema: track/episode data is under `item` now;
    // `track` is deprecated and empty. Expose it as `.track` so callers (and
    // reorderPlaylistTracks) keep working with the historical shape.
    const items: SpotifyPlaylistItem[] = rawItems.map((raw) => ({
      track: raw.item ?? raw.track ?? null,
    }));
    all.push(...items);
    offset += limit;

    // A short (or empty) page means there is nothing more; the reported total
    // (when present) is an upper bound.
    if (items.length < limit) break;
    if (typeof data.total === 'number' && all.length >= data.total) break;
  }

  Logger.debug('Fetched Spotify playlist items via /items endpoint', {
    playlistId,
    count: all.length,
  });

  return all;
}
