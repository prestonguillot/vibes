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
    });
  });

  it('stores a null count when the details count is not a number', () => {
    (window as any).playlistMeta.syncFromDetails(detailsEl('p1', NaN, false));
    expect((window as any).playlistMeta.getMeta('p1')).toEqual({
      trackCount: null,
      linkedCount: null,
      needsResync: false,
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
