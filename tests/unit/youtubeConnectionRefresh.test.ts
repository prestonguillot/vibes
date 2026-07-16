/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/youtubeConnectionRefresh.js: on the ?connected=youtube signal the Spotify
 * playlist list is refetched past the cache, and the post-swap restore runs.
 *
 * The restore hangs off the promise htmx.ajax returns. There is no `onload` option - htmx ignores
 * unknown context keys, so passing one silently never runs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Load the module with the given query string in the address bar.
 *
 * The module acts as it loads, so anything the refetch should see - the DOM, the htmx stub's
 * behaviour - has to be in place before the import, not after.
 */
async function setup(search = '?connected=youtube', ajaxImpl?: () => Promise<unknown>) {
  window.history.replaceState({}, '', `/${search}`);
  document.body.innerHTML = `
    <input type="checkbox" id="ownPlaylistsOnly" checked>
    <div id="playlists-content"></div>
    <input type="checkbox" class="playlist-expand-toggle" id="expand-p1" checked>
    <div id="details-p1"></div>`;

  // htmx.ajax(verb, path, context) - typed so mock.calls carries the real argument shape.
  const ajax = vi.fn(
    (_verb: string, _path: string, _context?: Record<string, unknown>) =>
      ajaxImpl?.() ?? Promise.resolve(),
  );
  (window as any).htmx = { ajax };
  (window as any).Logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  // Imported, not eval'd: v8 attributes coverage to a FILE, and eval'd code has none - so an
  // eval'd module stays invisible to the report however well it is tested. resetModules re-runs it
  // per test, which is what the eval gave us.
  vi.resetModules();
  await import('../../public/js/youtubeConnectionRefresh.js');
  return ajax;
}

const listRefetches = (ajax: ReturnType<typeof vi.fn>) =>
  ajax.mock.calls.filter((c) => String(c[1]).startsWith('/auth/spotify/playlists'));

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('youtubeConnectionRefresh on a connect', () => {
  it('refetches the playlist list past the cache', async () => {
    const ajax = await setup();
    await flush();

    expect(ajax).toHaveBeenCalledWith(
      'GET',
      '/auth/spotify/playlists?ownOnly=true',
      expect.objectContaining({
        target: '#playlists-content',
        swap: 'innerHTML',
        // Without this the browser serves the copy it fetched before the connect, in which every
        // playlist is unsynced - which is the entire reason to refetch.
        headers: { 'Cache-Control': 'no-cache' },
      }),
    );
  });

  it('carries the current own-only filter into the refetch', async () => {
    window.history.replaceState({}, '', '/?connected=youtube');
    document.body.innerHTML = `
      <input type="checkbox" id="ownPlaylistsOnly">
      <div id="playlists-content"></div>`;
    const ajax = vi.fn(() => Promise.resolve());
    (window as any).htmx = { ajax };
    (window as any).Logger = { error: vi.fn() };
    vi.resetModules();
    await import('../../public/js/youtubeConnectionRefresh.js');
    await flush();

    expect(ajax).toHaveBeenCalledWith(
      'GET',
      '/auth/spotify/playlists?ownOnly=false',
      expect.anything(),
    );
  });

  it('runs the post-swap restore: reloads details for expanded playlists', async () => {
    const ajax = await setup();
    await flush();

    // This second call only happens if the promise callback actually fires.
    expect(ajax).toHaveBeenCalledWith(
      'GET',
      '/api/playlistDetails/playlist/p1',
      expect.objectContaining({ target: '#details-p1', swap: 'innerHTML' }),
    );
    expect(ajax).toHaveBeenCalledTimes(2);
  });

  it('logs the real error when the refetch fails instead of swallowing it', async () => {
    const boom = new Error('network down');
    await setup('?connected=youtube', () => Promise.reject(boom));

    await flush();

    expect((window as any).Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to refresh playlists'),
      {},
      boom,
    );
  });

  // Reloading is an ordinary page load, and must not cost another full listing of both services.
  it('takes the marker out of the URL so a reload does not refetch again', async () => {
    await setup();
    await flush();

    expect(window.location.search).toBe('');
  });

  it('keeps any other query parameters when it removes the marker', async () => {
    await setup('?connected=youtube&debug=1');
    await flush();

    expect(window.location.search).toBe('?debug=1');
  });

  // The whole point of capturing state before the swap: a re-render clears the expand checkboxes,
  // and the restore must put them back. The mock stands in for that reset.
  it('re-checks an expanded checkbox the swap cleared, and clears the no-transition guard after', async () => {
    let firstCall = true;
    await setup('?connected=youtube', () => {
      // Only the initial list swap re-renders the checkbox; later detail calls must not touch it.
      if (firstCall) {
        firstCall = false;
        (document.getElementById('expand-p1') as HTMLInputElement).checked = false;
      }
      return Promise.resolve();
    });
    await flush();

    expect((document.getElementById('expand-p1') as HTMLInputElement).checked).toBe(true);
    expect(document.getElementById('playlists-content')!.classList.contains('no-transition')).toBe(
      false,
    );
  });

  it('defaults the own-only filter to true when there is no filter checkbox', async () => {
    window.history.replaceState({}, '', '/?connected=youtube');
    document.body.innerHTML = `<div id="playlists-content"></div>`; // no #ownPlaylistsOnly
    const ajax = vi.fn(() => Promise.resolve());
    (window as any).htmx = { ajax };
    (window as any).Logger = { error: vi.fn() };
    vi.resetModules();
    await import('../../public/js/youtubeConnectionRefresh.js');
    await flush();

    expect(ajax).toHaveBeenCalledWith(
      'GET',
      '/auth/spotify/playlists?ownOnly=true',
      expect.anything(),
    );
  });

  it('skips the details refetch for an expanded playlist that has no details container', async () => {
    window.history.replaceState({}, '', '/?connected=youtube');
    document.body.innerHTML = `
      <div id="playlists-content"></div>
      <input type="checkbox" class="playlist-expand-toggle" id="expand-p9" checked>`; // no #details-p9
    const ajax = vi.fn((_verb: string, _path: string) => Promise.resolve());
    (window as any).htmx = { ajax };
    (window as any).Logger = { error: vi.fn() };
    vi.resetModules();
    await import('../../public/js/youtubeConnectionRefresh.js');
    await flush();

    const detailsCalls = ajax.mock.calls.filter((c) =>
      String(c[1]).includes('/api/playlistDetails/'),
    );
    expect(detailsCalls).toHaveLength(0);
  });
});

describe('youtubeConnectionRefresh without a connect', () => {
  // The expensive case: an ordinary page load already renders the list with YouTube state from the
  // cookie, so refetching would list every playlist on both services again for nothing.
  it('does nothing on a plain page load', async () => {
    const ajax = await setup('');
    await flush();

    expect(ajax).not.toHaveBeenCalled();
  });

  it.each([['?connected=spotify'], ['?connected='], ['?connected=youtube2'], ['?other=youtube']])(
    'does nothing for %s',
    async (search) => {
      const ajax = await setup(search);
      await flush();

      expect(listRefetches(ajax)).toHaveLength(0);
    },
  );

  it('no longer responds to a status render announcing a connection', async () => {
    const ajax = await setup('');
    document.body.dispatchEvent(new Event('youtubeConnected'));
    await flush();

    expect(ajax).not.toHaveBeenCalled();
  });
});

describe('youtubeConnectionRefresh on a page without the list', () => {
  it('does nothing when there is no playlist container', async () => {
    window.history.replaceState({}, '', '/?connected=youtube');
    document.body.innerHTML = '';
    const ajax = vi.fn(() => Promise.resolve());
    (window as any).htmx = { ajax };
    vi.resetModules();
    await import('../../public/js/youtubeConnectionRefresh.js');
    await flush();

    expect(ajax).not.toHaveBeenCalled();
  });
});
