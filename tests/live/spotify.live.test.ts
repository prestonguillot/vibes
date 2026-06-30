/**
 * LIVE Spotify connectivity harness - opt-in, NOT part of the normal test cycle.
 *
 * Run with: `npm run test:spotify:live`
 *
 * Purpose: confirm (a) we can actually talk to Spotify with our client, and
 * (b) the REAL API responses still have the shapes our mocked tests assume
 * (spotifyClient.test.ts, syncRoute.test.ts, etc.). If Spotify changes a field
 * again (as in Feb 2026), these assertions fail and tell us the mocks are stale.
 *
 * Requires in .env:
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET   (the app credentials)
 *   SPOTIFY_TEST_REFRESH_TOKEN                 (a refresh token for a test account
 *                                               with at least one playlist)
 * If any are absent the whole suite is skipped, so it never fails when unconfigured.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  refreshAccessToken,
  getCurrentUser,
  getUserPlaylists,
  getPlaylist,
  SpotifyPlaylistSummary,
} from '../../src/utils/spotifyClient';
import { fetchAllPlaylistItems } from '../../src/utils/spotifyPlaylistItems';

const hasCreds = !!(
  process.env.SPOTIFY_CLIENT_ID &&
  process.env.SPOTIFY_CLIENT_SECRET &&
  process.env.SPOTIFY_TEST_REFRESH_TOKEN
);

if (!hasCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[spotify.live] skipped - set SPOTIFY_CLIENT_ID/SECRET and SPOTIFY_TEST_REFRESH_TOKEN in .env to run.\n',
  );
}

describe.skipIf(!hasCreds)('Spotify live API (mock-validation harness)', () => {
  let accessToken: string;
  let playlists: SpotifyPlaylistSummary[];

  beforeAll(async () => {
    const tokens = await refreshAccessToken(process.env.SPOTIFY_TEST_REFRESH_TOKEN!);
    accessToken = tokens.accessToken;
  });

  it('refresh token endpoint returns a usable access token', () => {
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
  });

  it('GET /me returns the shape getCurrentUser maps (id string, displayName string|null)', async () => {
    const user = await getCurrentUser(accessToken);
    expect(typeof user.id).toBe('string');
    expect(user.id.length).toBeGreaterThan(0);
    expect(user.displayName === null || typeof user.displayName === 'string').toBe(true);
  });

  it('GET /me/playlists returns the summary shape (id/name strings, count number|null)', async () => {
    playlists = await getUserPlaylists(accessToken);
    expect(Array.isArray(playlists)).toBe(true);
    for (const p of playlists) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(p.ownerId === null || typeof p.ownerId === 'string').toBe(true);
      expect(p.trackTotal === null || typeof p.trackTotal === 'number').toBe(true);
      expect(typeof p.spotifyUrl).toBe('string');
    }
  });

  it('GET /playlists/{id} returns name + count for the first playlist', async () => {
    if (!playlists?.length) return; // nothing to check on an empty account
    const detail = await getPlaylist(accessToken, playlists[0].id);
    expect(typeof detail.name).toBe('string');
    expect(detail.trackTotal === null || typeof detail.trackTotal === 'number').toBe(true);
  });

  it('GET /playlists/{id}/items still nests the track under `item` (Feb 2026 shape)', async () => {
    if (!playlists?.length) return;
    const items = await fetchAllPlaylistItems(accessToken, playlists[0].id);
    expect(Array.isArray(items)).toBe(true);
    // fetchAllPlaylistItems normalizes raw.item ?? raw.track. If Spotify moved the
    // field again, every track would come back null and this would fail.
    const withTracks = items.filter((i) => i.track != null);
    if (items.length > 0) {
      expect(withTracks.length).toBeGreaterThan(0);
      const track = withTracks[0].track!;
      expect(typeof track.id).toBe('string');
      expect(typeof track.name).toBe('string');
      expect(track.type).toBe('track');
    }
  });
});
