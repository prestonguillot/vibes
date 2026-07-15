/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/sync.js: the status box you watch during a sync. Progress streams in
 * declaratively via the htmx SSE extension; this module owns the dismiss control and what happens
 * when the stream closes - marking the outcome, and moving a newly-synced playlist into its
 * alphabetical place among the synced ones.
 *
 * It was at 0% coverage: shipped on every page load via index.ejs, never executed by a test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackListeners } from '@tests/helpers/clientListeners';

let listeners: ReturnType<typeof trackListeners>;

const statusBox = (playlistId: string, { succeeded = true } = {}) => `
  <div id="sync-status-${playlistId}" class="sync-status-box sync-status-working">
    <button class="sync-status-close"></button>
    ${succeeded ? '<span data-sync-success></span>' : '<span data-sync-error></span>'}
  </div>`;

const playlistRow = (id: string, name: string) =>
  `<div data-playlist-id="${id}"><h5>${name}</h5></div>`;

async function load() {
  listeners = trackListeners(document, document.body);
  vi.resetModules();
  await import('../../public/js/sync.js');
  listeners.stop();
}

const box = (playlistId: string) => document.getElementById(`sync-status-${playlistId}`)!;

/** The server's "close" frame, as the htmx SSE extension surfaces it. */
const sseClose = (target: Element, type = 'message') =>
  target.dispatchEvent(new CustomEvent('htmx:sseClose', { detail: { type }, bubbles: true }));

const playlistOrder = () =>
  Array.from(document.querySelectorAll('#playlists-content [data-playlist-id]')).map(
    (el) => el.querySelector('h5')!.textContent,
  );

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
  document.body.innerHTML = '';
  // happy-dom does not implement scrollIntoView, and sync.js calls it after moving a playlist.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  listeners?.removeAll();
  vi.useRealTimers();
});

describe('sync.js: dismissing a status box', () => {
  it('fades the box out, then hides it', async () => {
    document.body.innerHTML = statusBox('p1');
    await load();

    box('p1').querySelector<HTMLElement>('.sync-status-close')!.click();
    expect(box('p1').classList.contains('fade-out')).toBe(true);
    expect(box('p1').classList.contains('hidden')).toBe(false);

    vi.advanceTimersByTime(300);

    expect(box('p1').classList.contains('fade-out')).toBe(false);
    expect(box('p1').classList.contains('hidden')).toBe(true);
  });

  it('ignores clicks that are not on a close control', async () => {
    document.body.innerHTML = statusBox('p1') + '<button id="other"></button>';
    await load();

    document.getElementById('other')!.click();
    vi.advanceTimersByTime(300);

    expect(box('p1').classList.contains('hidden')).toBe(false);
  });
});

describe('sync.js: when the stream closes', () => {
  it('marks a successful sync and stops showing it as working', async () => {
    document.body.innerHTML = statusBox('p1');
    await load();

    sseClose(box('p1'));

    expect(box('p1').classList.contains('sync-status-success')).toBe(true);
    expect(box('p1').classList.contains('sync-status-working')).toBe(false);
  });

  it('marks a failed sync as an error', async () => {
    document.body.innerHTML = statusBox('p1', { succeeded: false });
    await load();

    sseClose(box('p1'));

    expect(box('p1').classList.contains('sync-status-error')).toBe(true);
    expect(box('p1').classList.contains('sync-status-working')).toBe(false);
  });

  it('auto-hides a successful box after 5s', async () => {
    document.body.innerHTML = statusBox('p1');
    await load();

    sseClose(box('p1'));
    expect(box('p1').classList.contains('hidden')).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(box('p1').classList.contains('fade-out')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(box('p1').classList.contains('hidden')).toBe(true);
  });

  // A failure stays on screen: it is the only place the reason is shown.
  it('never auto-hides a failed box', async () => {
    document.body.innerHTML = statusBox('p1', { succeeded: false });
    await load();

    sseClose(box('p1'));
    vi.advanceTimersByTime(60_000);

    expect(box('p1').classList.contains('hidden')).toBe(false);
  });

  // sseClose also fires for nodeReplaced/nodeMissing when htmx tears the element down.
  it('ignores a close that is not a message frame', async () => {
    document.body.innerHTML = statusBox('p1');
    await load();

    sseClose(box('p1'), 'nodeMissing');

    expect(box('p1').classList.contains('sync-status-success')).toBe(false);
    expect(box('p1').classList.contains('sync-status-working')).toBe(true);
  });
});

describe('sync.js: moving a synced playlist into place', () => {
  const page = (rows: string) => statusBox('p2') + `<div id="playlists-content">${rows}</div>`;

  it('inserts the playlist before the first later-sorting name', async () => {
    document.body.innerHTML = page(
      playlistRow('p1', 'Alpha') + playlistRow('p3', 'Zulu') + playlistRow('p2', 'Mike'),
    );
    await load();

    sseClose(box('p2'));

    expect(playlistOrder()).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('appends the playlist when it sorts last', async () => {
    document.body.innerHTML = page(
      playlistRow('p1', 'Alpha') + playlistRow('p2', 'Zulu') + playlistRow('p3', 'Mike'),
    );
    await load();

    sseClose(box('p2'));

    expect(playlistOrder()).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('scrolls the moved playlist into view', async () => {
    document.body.innerHTML = page(playlistRow('p2', 'Mike'));
    await load();

    sseClose(box('p2'));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('does not move anything when the sync failed', async () => {
    document.body.innerHTML =
      statusBox('p2', { succeeded: false }) +
      `<div id="playlists-content">${playlistRow('p3', 'Alpha') + playlistRow('p2', 'Zulu')}</div>`;
    await load();

    sseClose(box('p2'));

    expect(playlistOrder()).toEqual(['Alpha', 'Zulu']);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('survives a page with no playlist list rendered', async () => {
    document.body.innerHTML = statusBox('p2');
    await load();

    expect(() => sseClose(box('p2'))).not.toThrow();
    expect(box('p2').classList.contains('sync-status-success')).toBe(true);
  });
});
