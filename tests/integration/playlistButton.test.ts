/**
 * Tests for GET /auth/spotify/playlist-button/:playlistId - the per-playlist sync button.
 *
 * The button's label is the app's only signal for whether a playlist has been synced yet. That
 * makes the label the button: "Sync to YouTube" on a playlist that is already synced is not a
 * degraded button, it is a wrong answer to the only question this endpoint is asked, and it sends
 * the user to spend YouTube quota finding out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const h = vi.hoisted(() => ({
  ensureValidSpotifyToken: vi.fn(),
  getPlaylist: vi.fn(),
  playlistsList: vi.fn(),
  ensureValidYouTubeToken: vi.fn(),
}));

vi.mock('@/spotify/auth', () => ({ ensureValidSpotifyToken: h.ensureValidSpotifyToken }));
vi.mock('@/spotify/client', async (importActual) => ({
  ...(await importActual<typeof import('@/spotify/client')>()),
  getPlaylist: h.getPlaylist,
}));
vi.mock('@/youtube/client', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/client')>()),
  createYoutubeClient: () => ({ playlists: { list: h.playlistsList } }),
}));
vi.mock('@/youtube/auth', async (importActual) => ({
  ...(await importActual<typeof import('@/youtube/auth')>()),
  ensureValidYouTubeToken: h.ensureValidYouTubeToken,
}));

import { createApp } from '@/app';
import { spotifyTokenCookie, youtubeTokenCookie } from '@tests/helpers/tokenCookies';
import { testServer } from '@tests/helpers/testServer';

const app = testServer(createApp());

const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';
const SPOTIFY_COOKIE = spotifyTokenCookie();
const YOUTUBE_COOKIE = youtubeTokenCookie();

const button = (cookies: string[] = [SPOTIFY_COOKIE, YOUTUBE_COOKIE]) =>
  request(app).get(`/auth/spotify/playlist-button/${PLAYLIST_ID}`).set('Cookie', cookies);

const synced = { id: 'PL', snippet: { title: 'My Playlist (from Spotify)' } };

beforeEach(() => {
  vi.clearAllMocks();
  h.ensureValidSpotifyToken.mockResolvedValue('access-token');
  h.getPlaylist.mockResolvedValue({
    id: PLAYLIST_ID,
    name: 'My Playlist',
    ownerId: 'me',
    trackTotal: 42,
    spotifyUrl: 'https://open.spotify.com/playlist/x',
  });
  h.playlistsList.mockResolvedValue({ data: { items: [] } });
  h.ensureValidYouTubeToken.mockResolvedValue({
    client: { playlists: { list: h.playlistsList } },
    accessToken: 'yt',
    quotaUsed: 0,
  });
});

describe('the button before both services are connected', () => {
  it('asks for Spotify when Spotify is not connected', async () => {
    const response = await button([]);

    expect(response.status).toBe(401);
    expect(response.text).toContain('Connect to Spotify First');
  });

  // Not a 401: Spotify IS connected, the playlist list renders, and this button is simply not
  // usable yet. A 401 here would read as an auth failure on a page that is working.
  it('asks for YouTube, without failing, when only Spotify is connected', async () => {
    const response = await button([SPOTIFY_COOKIE]);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Connect to YouTube to Sync');
  });

  it('does not call Spotify before both are connected', async () => {
    await button([SPOTIFY_COOKIE]);

    expect(h.getPlaylist).not.toHaveBeenCalled();
  });
});

describe('the button label', () => {
  it('offers to sync a playlist that has no YouTube counterpart', async () => {
    h.playlistsList.mockResolvedValue({ data: { items: [] } });

    const response = await button();

    expect(response.status).toBe(200);
    expect(response.text).toContain('Sync to YouTube');
    expect(response.text).toContain('btn-primary');
  });

  it('offers to update a playlist that is already synced', async () => {
    h.playlistsList.mockResolvedValue({ data: { items: [synced] } });

    const response = await button();

    expect(response.text).toContain('Update YouTube Playlist');
    expect(response.text).toContain('btn-outline-success');
  });

  // The match is by the synced-title convention, so a playlist of the same name that was not
  // created by a sync must not read as synced.
  it('does not treat an unrelated YouTube playlist as a sync', async () => {
    h.playlistsList.mockResolvedValue({
      data: { items: [{ id: 'PL', snippet: { title: 'My Playlist' } }] },
    });

    const response = await button();

    expect(response.text).toContain('Sync to YouTube');
  });

  it('renders the playlist name and track count', async () => {
    const response = await button();

    expect(response.text).toContain('My Playlist');
    expect(response.text).toContain('42');
  });

  it('renders a playlist with no track count as zero', async () => {
    h.getPlaylist.mockResolvedValue({
      id: PLAYLIST_ID,
      name: 'My Playlist',
      ownerId: 'me',
      trackTotal: null,
      spotifyUrl: 'u',
    });

    const response = await button();

    expect(response.status).toBe(200);
    expect(response.text).toContain('0');
  });
});

describe('when something fails', () => {
  /**
   * This used to render "Sync to YouTube" on a lookup failure, on the reasoning that an outage
   * "must not cost the user the button - it only decides the label". But the label IS the button:
   * it is the app's only signal for whether a playlist has been synced, and answering "not synced"
   * because the question could not be asked sends the user to run a sync that was already done and
   * pay YouTube for it. A failure the route cannot interpret is reported, not guessed at.
   */
  it('reports the failure rather than guessing at the label', async () => {
    h.playlistsList.mockRejectedValue(new Error('youtube is down'));

    const response = await button();

    expect(response.status).toBe(500);
    expect(response.text).not.toContain('Sync to YouTube');
  });

  // An hour-old token is the ordinary case for a page left open, not a failure: refresh and answer.
  it('refreshes an expired YouTube token rather than mislabelling the button', async () => {
    h.ensureValidYouTubeToken.mockResolvedValue({
      client: { playlists: { list: vi.fn(async () => ({ data: { items: [synced] } })) } },
      accessToken: 'refreshed',
      quotaUsed: 0,
    });

    const response = await button();

    expect(response.status).toBe(200);
    expect(response.text).toContain('Update YouTube Playlist');
  });

  it('asks the user to reconnect when the Spotify token cannot be refreshed', async () => {
    h.ensureValidSpotifyToken.mockRejectedValue(new Error('SPOTIFY_AUTH_REQUIRED'));

    const response = await button();

    expect(response.status).toBe(401);
    expect(response.text).toContain('Reconnect to Spotify');
  });

  it('reports an error when the playlist cannot be fetched', async () => {
    h.getPlaylist.mockRejectedValue(new Error('spotify exploded'));

    const response = await button();

    expect(response.status).toBe(500);
    expect(response.text).toContain('Error');
  });

  it('rejects a malformed playlist id', async () => {
    const response = await request(app)
      .get('/auth/spotify/playlist-button/nope')
      .set('Cookie', [SPOTIFY_COOKIE, YOUTUBE_COOKIE]);

    expect(response.status).toBe(400);
  });
});
