/**
 * @vitest-environment happy-dom
 *
 * Tests for the client-side playlist metadata cache (public/js/playlistMeta.js):
 * it records the track count + drift state from a loaded details view and uses it
 * to decorate the collapsed list row (track summary text + out-of-sync dot).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, '../../public/js/playlistMeta.js'), 'utf-8');

function loadModule() {
  // eslint-disable-next-line no-eval
  (0, eval)(source);
}

function makeRow(id: string, youtubeCount: number) {
  document.body.innerHTML = `
    <div class="playlist-item" data-playlist-id="${id}" data-youtube-count="${youtubeCount}">
      <h5><span class="drift-dot" data-drift-dot></span></h5>
      <p class="playlist-track-summary">Open to view tracks</p>
    </div>`;
  return document.querySelector('.playlist-item') as HTMLElement;
}

function detailsEl(id: string, trackCount: number, needsResync: boolean) {
  const div = document.createElement('div');
  div.innerHTML = `<div class="playlist-details" data-playlist-id="${id}" data-track-count="${trackCount}" data-needs-resync="${needsResync}"></div>`;
  return div;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  loadModule();
});

describe('playlistMeta cache', () => {
  it('records count + drift from a details view via syncFromDetails', () => {
    (window as any).playlistMeta.syncFromDetails(detailsEl('p1', 42, true));
    expect((window as any).playlistMeta.getMeta('p1')).toEqual({
      trackCount: 42,
      needsResync: true,
    });
  });

  it('stores a null count when the details count is not a number', () => {
    (window as any).playlistMeta.syncFromDetails(detailsEl('p1', NaN, false));
    expect((window as any).playlistMeta.getMeta('p1')).toEqual({
      trackCount: null,
      needsResync: false,
    });
  });

  it('decorates a synced row as "N synced to YouTube of M"', () => {
    const row = makeRow('p1', 30);
    (window as any).playlistMeta.setMeta('p1', { trackCount: 33, needsResync: false });
    (window as any).playlistMeta.decorateRow(row);
    expect(row.querySelector('.playlist-track-summary')!.textContent).toBe(
      '30 tracks synced to YouTube of 33',
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
