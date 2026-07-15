/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/playlistFilter.js: the refresh button is usable only when Spotify is
 * connected, and it re-evaluates whenever htmx swaps a status area.
 *
 * This is the code tests/unit/refreshButton.test.ts CLAIMED to cover. It never imported anything -
 * it re-declared `const dataConnected = 'false'` in the test body and asserted `'false' !== 'true'`.
 * It also asserted the button enables only when BOTH services are connected, which was never true:
 * refreshing the playlist list only needs Spotify. Twelve tests, all passing, all wrong.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackListeners } from '@tests/helpers/clientListeners';

let listeners: ReturnType<typeof trackListeners>;

/** The page as index.ejs renders it: a status area holding the connection button, plus refresh. */
function render({ spotify, youtube }: { spotify?: string; youtube?: string } = {}) {
  const button = (service: string, connected?: string) =>
    connected === undefined
      ? ''
      : `<button data-service="${service}" data-connected="${connected}"></button>`;

  document.body.innerHTML = `
    <div id="spotify-status">${button('spotify', spotify)}</div>
    <div id="youtube-status">${button('youtube', youtube)}</div>
    <button id="refresh-playlists-btn" disabled></button>`;
}

async function load() {
  listeners = trackListeners(document, document.body);
  vi.resetModules();
  await import('../../public/js/playlistFilter.js');
  listeners.stop();
  // The module does its work on DOMContentLoaded, which has already fired in happy-dom.
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

const refreshBtn = () => document.getElementById('refresh-playlists-btn') as HTMLButtonElement;

/** htmx announcing that it replaced the contents of a status area. */
const swap = (targetId: string) =>
  document.body.dispatchEvent(
    new CustomEvent('htmx:afterSwap', {
      detail: { target: document.getElementById(targetId) },
      bubbles: true,
    }),
  );

beforeEach(() => vi.restoreAllMocks());
afterEach(() => listeners?.removeAll());

describe('playlistFilter.js: refresh button enablement', () => {
  it('enables refresh when Spotify is connected', async () => {
    render({ spotify: 'true' });
    await load();

    expect(refreshBtn().disabled).toBe(false);
    expect(refreshBtn().classList.contains('disabled')).toBe(false);
    expect(refreshBtn().title).toBe('Refresh playlist list from Spotify');
  });

  it('leaves refresh disabled when Spotify is not connected', async () => {
    render({ spotify: 'false' });
    await load();

    expect(refreshBtn().disabled).toBe(true);
    expect(refreshBtn().classList.contains('disabled')).toBe(true);
    expect(refreshBtn().title).toBe('Connect to Spotify to refresh playlists');
  });

  // Only exactly "true" counts. A status area mid-load renders data-connected="loading".
  it.each([['loading'], ['']])('treats data-connected=%o as not connected', async (state) => {
    render({ spotify: state });
    await load();

    expect(refreshBtn().disabled).toBe(true);
  });

  it('leaves refresh disabled when the Spotify status has not rendered a button yet', async () => {
    render({});
    await load();

    expect(refreshBtn().disabled).toBe(true);
  });

  // The refresh list comes from Spotify alone, so YouTube must not gate it. The deleted
  // refreshButton.test.ts asserted the opposite and never noticed.
  it('enables refresh on Spotify alone, with YouTube disconnected', async () => {
    render({ spotify: 'true', youtube: 'false' });
    await load();

    expect(refreshBtn().disabled).toBe(false);
  });

  it('does not enable refresh on YouTube alone', async () => {
    render({ spotify: 'false', youtube: 'true' });
    await load();

    expect(refreshBtn().disabled).toBe(true);
  });
});

describe('playlistFilter.js: re-evaluates after an htmx swap', () => {
  it('enables refresh when Spotify connects after load', async () => {
    render({ spotify: 'false' });
    await load();
    expect(refreshBtn().disabled).toBe(true);

    document.querySelector('#spotify-status button')!.setAttribute('data-connected', 'true');
    swap('spotify-status');

    expect(refreshBtn().disabled).toBe(false);
  });

  it('disables refresh again when Spotify disconnects', async () => {
    render({ spotify: 'true' });
    await load();
    expect(refreshBtn().disabled).toBe(false);

    document.querySelector('#spotify-status button')!.setAttribute('data-connected', 'false');
    swap('spotify-status');

    expect(refreshBtn().disabled).toBe(true);
  });

  it('re-checks on a YouTube swap too (the areas render together)', async () => {
    render({ spotify: 'false', youtube: 'false' });
    await load();

    document.querySelector('#spotify-status button')!.setAttribute('data-connected', 'true');
    swap('youtube-status');

    expect(refreshBtn().disabled).toBe(false);
  });

  it('ignores swaps of unrelated targets', async () => {
    render({ spotify: 'false' });
    await load();

    document.querySelector('#spotify-status button')!.setAttribute('data-connected', 'true');
    document.body.insertAdjacentHTML('beforeend', '<div id="playlists-content"></div>');
    swap('playlists-content');

    expect(refreshBtn().disabled).toBe(true);
  });
});
