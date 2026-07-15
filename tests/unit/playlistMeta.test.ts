/**
 * @vitest-environment happy-dom
 *
 * Tests for the client-side playlist metadata cache (public/js/playlistMeta.js):
 * it records the track count + drift state from a loaded details view and uses it
 * to decorate the collapsed list row (track summary text + out-of-sync dot).
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Imported, not eval'd: v8 attributes coverage to a FILE, and eval'd code has none - so an
// eval'd module stays invisible to the report however well it is tested. resetModules re-runs it
// per test, which is what the eval gave us.
async function loadModule() {
  vi.resetModules();
  await import('../../public/js/playlistMeta.js');
}

function makeRow(id: string, youtubeCount: number) {
  document.body.innerHTML = `
    <div class="playlist-item" data-playlist-id="${id}" data-youtube-count="${youtubeCount}">
      <h5><span class="drift-dot" data-drift-dot></span></h5>
      <p class="playlist-track-summary">Open to view tracks</p>
    </div>`;
  return document.querySelector('.playlist-item') as HTMLElement;
}

function detailsEl(id: string, trackCount: number, needsResync: boolean, linkedCount?: number) {
  const linkedAttr = linkedCount === undefined ? '' : ` data-linked-count="${linkedCount}"`;
  const div = document.createElement('div');
  div.innerHTML = `<div class="playlist-details" data-playlist-id="${id}" data-track-count="${trackCount}"${linkedAttr} data-needs-resync="${needsResync}"></div>`;
  return div;
}

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  await loadModule();
});

describe('playlistMeta cache', () => {
  it('records count + linked + drift from a details view via syncFromDetails', () => {
    (window as any).playlistMeta.syncFromDetails(detailsEl('p1', 42, true, 40));
    expect((window as any).playlistMeta.getMeta('p1')).toEqual({
      trackCount: 42,
      linkedCount: 40,
      needsResync: true,
      updatedAt: expect.any(Number),
    });
  });

  it('stores a null count when the details count is not a number', () => {
    (window as any).playlistMeta.syncFromDetails(detailsEl('p1', NaN, false));
    expect((window as any).playlistMeta.getMeta('p1')).toEqual({
      trackCount: null,
      linkedCount: null,
      needsResync: false,
      updatedAt: expect.any(Number),
    });
  });

  it('decorates a synced row as "N of M tracks synced to YouTube"', () => {
    const row = makeRow('p1', 30);
    (window as any).playlistMeta.setMeta('p1', {
      trackCount: 33,
      linkedCount: 30,
      needsResync: false,
    });
    (window as any).playlistMeta.decorateRow(row);
    expect(row.querySelector('.playlist-track-summary')!.textContent).toBe(
      '30 of 33 tracks synced to YouTube',
    );
  });

  it("prefers the details linked count over the row's stale data-youtube-count", () => {
    // The row was rendered with the list BEFORE a sync (63), so its attribute is stale. After the
    // sync the details reports 141 linked of 145 - the row must show the fresh number, not 63.
    const row = makeRow('p1', 63);
    (window as any).playlistMeta.syncFromDetails(detailsEl('p1', 145, false, 141));
    (window as any).playlistMeta.decorateRow(row);
    expect(row.querySelector('.playlist-track-summary')!.textContent).toBe(
      '141 of 145 tracks synced to YouTube',
    );
  });

  it('falls back to the row count when the details published no linked count', () => {
    const row = makeRow('p1', 30);
    (window as any).playlistMeta.setMeta('p1', { trackCount: 33, needsResync: false });
    (window as any).playlistMeta.decorateRow(row);
    expect(row.querySelector('.playlist-track-summary')!.textContent).toBe(
      '30 of 33 tracks synced to YouTube',
    );
  });

  it('decorates an unsynced row (no YouTube videos) as "M tracks"', () => {
    const row = makeRow('p1', 0);
    (window as any).playlistMeta.setMeta('p1', { trackCount: 33, needsResync: false });
    (window as any).playlistMeta.decorateRow(row);
    expect(row.querySelector('.playlist-track-summary')!.textContent).toBe('33 tracks');
  });

  it('shows the drift dot only when needsResync is true', () => {
    const row = makeRow('p1', 30);
    (window as any).playlistMeta.setMeta('p1', { trackCount: 33, needsResync: true });
    (window as any).playlistMeta.decorateRow(row);
    expect(row.querySelector('[data-drift-dot]')!.classList.contains('is-visible')).toBe(true);

    (window as any).playlistMeta.setMeta('p1', { trackCount: 33, needsResync: false });
    (window as any).playlistMeta.decorateRow(row);
    expect(row.querySelector('[data-drift-dot]')!.classList.contains('is-visible')).toBe(false);
  });

  it('leaves a row untouched when nothing is cached', () => {
    const row = makeRow('p1', 0);
    (window as any).playlistMeta.decorateRow(row);
    expect(row.querySelector('.playlist-track-summary')!.textContent).toBe('Open to view tracks');
  });
});

/**
 * A sync delivers the playlist's refreshed details out-of-band: the stream's last frame carries
 * `hx-swap-oob="innerHTML:#details-<id>"` alongside the status box it is actually replacing.
 *
 * htmx announces those with htmx:oobAfterSwap - htmx:afterSwap fires for the status box, whose
 * subtree does not contain the details at all. Listening only for afterSwap, and only inside its
 * target, left the collapsed row painted from the meta cached before the sync: the flyout read
 * "141 of 141" and no drift, while the row above it still said "140 of 141" with the dot lit.
 */
describe('playlistMeta after a sync swaps the details out-of-band', () => {
  /** The details HTML a sync's final frame drops into #details-<id>, outside any swap target. */
  function swapDetailsOob(
    id: string,
    trackCount: number,
    linkedCount: number,
    needsResync = false,
  ) {
    const target = document.getElementById(`details-${id}`)!;
    target.innerHTML = `<div class="playlist-details" data-playlist-id="${id}" data-track-count="${trackCount}" data-linked-count="${linkedCount}" data-needs-resync="${needsResync}"></div>`;
    return target;
  }

  function pageWithSyncedPlaylist(id: string) {
    document.body.innerHTML = `
      <div class="playlist-item" data-playlist-id="${id}" data-youtube-count="140">
        <h5><span class="drift-dot" data-drift-dot></span></h5>
        <p class="playlist-track-summary">Open to view tracks</p>
      </div>
      <div id="details-${id}"></div>
      <div class="sync-status-box" id="sync-status-${id}"></div>`;

    // What the row knew before the sync: one track short, and drifted.
    (window as any).playlistMeta.setMeta(id, {
      trackCount: 141,
      linkedCount: 140,
      needsResync: true,
    });
    (window as any).playlistMeta.decorateAll();
  }

  const summary = (id: string) =>
    document.querySelector(`.playlist-item[data-playlist-id="${id}"] .playlist-track-summary`)!
      .textContent;
  const dotLit = (id: string) =>
    document
      .querySelector(`.playlist-item[data-playlist-id="${id}"] [data-drift-dot]`)!
      .classList.contains('is-visible');

  it('updates the row from details delivered out-of-band', () => {
    pageWithSyncedPlaylist('p1');
    expect(summary('p1')).toBe('140 of 141 tracks synced to YouTube');
    expect(dotLit('p1')).toBe(true);

    const target = swapDetailsOob('p1', 141, 141, false);
    target.dispatchEvent(new Event('htmx:oobAfterSwap', { bubbles: true }));

    expect(summary('p1')).toBe('141 of 141 tracks synced to YouTube');
    expect(dotLit('p1')).toBe(false);
  });

  // The status box is what htmx:afterSwap reports; the details are somewhere else entirely.
  it('updates the row even though the swapped element does not contain the details', () => {
    pageWithSyncedPlaylist('p1');
    swapDetailsOob('p1', 141, 141, false);

    const box = document.getElementById('sync-status-p1')!;
    box.dispatchEvent(new Event('htmx:afterSwap', { bubbles: true }));

    expect(summary('p1')).toBe('141 of 141 tracks synced to YouTube');
    expect(dotLit('p1')).toBe(false);
  });

  it('leaves other playlists alone', () => {
    pageWithSyncedPlaylist('p1');
    (window as any).playlistMeta.setMeta('p2', {
      trackCount: 10,
      linkedCount: 3,
      needsResync: true,
    });

    const target = swapDetailsOob('p1', 141, 141, false);
    target.dispatchEvent(new Event('htmx:oobAfterSwap', { bubbles: true }));

    expect((window as any).playlistMeta.getMeta('p2')).toEqual({
      trackCount: 10,
      linkedCount: 3,
      needsResync: true,
      updatedAt: expect.any(Number),
    });
  });
});

/**
 * Which of the page and the cache is right depends on which is newer.
 *
 * A hard refresh re-fetches the list, so the counts in the page are minutes-fresh while the cache
 * may be days old - and reading the cache first regardless is what showed a synced playlist as
 * "140 of 141" with the drift dot lit, on a page whose own HTML said 141 of 141.
 */
describe('playlistMeta on a cold load', () => {
  /** A row as the server renders it, with a cache entry left over from an earlier visit. */
  function coldLoad(opts: {
    serverLinked: number;
    serverTracks: number | '';
    cached: { trackCount: number | null; linkedCount: number | null; needsResync: boolean };
  }) {
    document.body.innerHTML = `
      <div class="playlist-item" data-playlist-id="p1"
           data-youtube-count="${opts.serverLinked}"
           data-track-count="${opts.serverTracks}">
        <h5><span class="drift-dot" data-drift-dot></span></h5>
        <p class="playlist-track-summary">rendered by the server</p>
      </div>`;

    // Straight into storage, stamped before this page: what an earlier visit left behind.
    localStorage.setItem(
      'playlist-meta',
      JSON.stringify({ p1: { ...opts.cached, updatedAt: Date.now() - 60_000 } }),
    );
    (window as any).playlistMeta.decorateAll();
    return document.querySelector('.playlist-track-summary')!.textContent;
  }

  it('shows the count the server just fetched, not the one cached before the sync', () => {
    const summary = coldLoad({
      serverLinked: 141,
      serverTracks: 141,
      cached: { trackCount: 141, linkedCount: 140, needsResync: true },
    });

    expect(summary).toBe('141 of 141 tracks synced to YouTube');
  });

  // Spotify omits the total in Dev Mode, so the cache is the only place that number exists - old
  // or not, it beats having nothing to show.
  it('falls back to the cached total when the server had none to give', () => {
    const summary = coldLoad({
      serverLinked: 141,
      serverTracks: '',
      cached: { trackCount: 141, linkedCount: 140, needsResync: false },
    });

    expect(summary).toBe('141 of 141 tracks synced to YouTube');
  });

  // An entry cached before stamping existed is from an earlier visit by definition.
  it('treats an unstamped entry as older than the page', () => {
    document.body.innerHTML = `
      <div class="playlist-item" data-playlist-id="p1" data-youtube-count="141" data-track-count="141">
        <h5><span class="drift-dot" data-drift-dot></span></h5>
        <p class="playlist-track-summary">rendered by the server</p>
      </div>`;
    localStorage.setItem(
      'playlist-meta',
      JSON.stringify({ p1: { trackCount: 141, linkedCount: 140, needsResync: true } }),
    );

    (window as any).playlistMeta.decorateAll();

    expect(document.querySelector('.playlist-track-summary')!.textContent).toBe(
      '141 of 141 tracks synced to YouTube',
    );
  });

  // The server cannot know drift without the per-playlist comparison the details view does, so
  // last-known is all there is - and is why opening the row is still what settles it.
  it('still shows the last known drift dot, which the server cannot speak to', () => {
    coldLoad({
      serverLinked: 141,
      serverTracks: 141,
      cached: { trackCount: 141, linkedCount: 140, needsResync: true },
    });

    expect(document.querySelector('[data-drift-dot]')!.classList.contains('is-visible')).toBe(true);
  });

  // The page is the stale one once a sync has run against it.
  it('lets a details view loaded since the page render win', () => {
    document.body.innerHTML = `
      <div class="playlist-item" data-playlist-id="p1" data-youtube-count="140" data-track-count="141">
        <h5><span class="drift-dot" data-drift-dot></span></h5>
        <p class="playlist-track-summary">rendered by the server</p>
      </div>`;

    (window as any).playlistMeta.syncFromDetails(detailsEl('p1', 141, false, 141));
    (window as any).playlistMeta.decorateAll();

    expect(document.querySelector('.playlist-track-summary')!.textContent).toBe(
      '141 of 141 tracks synced to YouTube',
    );
  });
});
