/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/youtubeConnectionRefresh.js: when YouTube connects, the Spotify playlist
 * list is refetched (cache-busting) and the post-swap restore runs.
 *
 * The restore used to be passed as an `onload` key to htmx.ajax, which has no such option and
 * ignores unknown keys - so it never ran. It hangs off the returned promise instead.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '../../public/js/youtubeConnectionRefresh.js'),
  'utf-8',
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  document.body.innerHTML = `
    <input type="checkbox" id="ownPlaylistsOnly" checked>
    <div id="playlists-content"></div>
    <input type="checkbox" class="playlist-expand-toggle" id="expand-p1" checked>
    <div id="details-p1"></div>`;

  const ajax = vi.fn(() => Promise.resolve());
  (window as any).htmx = { ajax };
  (window as any).Logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  // eslint-disable-next-line no-eval
  (0, eval)(source);
  return ajax;
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('youtubeConnectionRefresh', () => {
  it('refetches the playlist list with a cache-busting header on youtubeConnected', async () => {
    const ajax = setup();
    document.body.dispatchEvent(new Event('youtubeConnected'));
    await flush();

    expect(ajax).toHaveBeenCalledWith(
      'GET',
      '/auth/spotify/playlists?ownOnly=true',
      expect.objectContaining({
        target: '#playlists-content',
        swap: 'innerHTML',
        headers: { 'Cache-Control': 'no-cache' },
      }),
    );
  });

  it('runs the post-swap restore: reloads details for expanded playlists', async () => {
    const ajax = setup();
    document.body.dispatchEvent(new Event('youtubeConnected'));
    await flush();

    // The regression: this second call only happens if the promise callback actually fires.
    expect(ajax).toHaveBeenCalledWith(
      'GET',
      '/api/playlistDetails/playlist/p1',
      expect.objectContaining({ target: '#details-p1', swap: 'innerHTML' }),
    );
    expect(ajax).toHaveBeenCalledTimes(2);
  });

  it('only refreshes once, not on every status heartbeat', async () => {
    const ajax = setup();
    // The status endpoint emits youtubeConnected on EVERY poll while connected, not just on the
    // connect transition; refetching the whole library each time hammers Spotify into a 429.
    document.body.dispatchEvent(new Event('youtubeConnected'));
    await flush();
    document.body.dispatchEvent(new Event('youtubeConnected'));
    document.body.dispatchEvent(new Event('youtubeConnected'));
    await flush();

    const listRefetches = ajax.mock.calls.filter(
      (c) => c[1] === '/auth/spotify/playlists?ownOnly=true',
    );
    expect(listRefetches).toHaveLength(1);
  });

  it('logs the real error when the refetch fails instead of swallowing it', async () => {
    const ajax = setup();
    const boom = new Error('network down');
    ajax.mockReturnValueOnce(Promise.reject(boom));

    document.body.dispatchEvent(new Event('youtubeConnected'));
    await flush();

    expect((window as any).Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to refresh playlists'),
      {},
      boom,
    );
  });
});
