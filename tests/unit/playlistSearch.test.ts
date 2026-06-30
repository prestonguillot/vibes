/**
 * Behavior tests for the client-side playlist search (public/js/playlistSearch.js).
 * Verifies the simple word-substring matching filters rows by title and by
 * lazy-loaded track names, order-independently - and resets when cleared.
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const script = fs.readFileSync(path.join(__dirname, '../../public/js/playlistSearch.js'), 'utf-8');

// Track names the (mocked) /api/playlistTracks endpoint returns per playlist id.
const TRACKS: Record<string, string[]> = {
  'pl-1': ['Blinding Lights'],
  'pl-2': [],
  'pl-3': ['Eye of the Tiger'],
};

function row(id: string, title: string): string {
  return `<div class="playlist-item" data-playlist-id="${id}"><h5 class="playlist-title">${title}</h5></div>`;
}

function hidden(id: string): boolean {
  return document.querySelector(`[data-playlist-id="${id}"]`)!.classList.contains('search-hidden');
}

// Type into the search box and let the debounce + lazy track fetch settle.
async function search(query: string): Promise<void> {
  const input = document.getElementById('playlistSearch') as HTMLInputElement;
  input.value = query;
  input.dispatchEvent(new window.Event('keyup'));
  await vi.runAllTimersAsync();
}

describe('playlist search (client-side filtering)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { Logger?: unknown }).Logger = { error: vi.fn() };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => TRACKS,
    }) as typeof fetch;

    document.body.innerHTML = `
      <input id="playlistSearch" type="text" />
      <div id="playlists-content">
        ${row('pl-1', 'Blinding Lights Mix')}
        ${row('pl-2', 'Chill Vibes')}
        ${row('pl-3', 'Workout Mix')}
      </div>
    `;

    // eslint-disable-next-line no-eval
    eval(script);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  });

  afterEach(() => vi.useRealTimers());

  it('hides rows whose title does not match the query', async () => {
    await search('blinding');
    expect(hidden('pl-1')).toBe(false);
    expect(hidden('pl-2')).toBe(true);
    expect(hidden('pl-3')).toBe(true);
  });

  it('matches query words in any order (substring, order-independent)', async () => {
    await search('mix workout');
    expect(hidden('pl-3')).toBe(false); // "Workout Mix"
    expect(hidden('pl-2')).toBe(true);
  });

  it('matches on lazy-loaded track names, not just the title', async () => {
    await search('tiger'); // only pl-3 has the track "Eye of the Tiger"
    expect(hidden('pl-3')).toBe(false);
    expect(hidden('pl-1')).toBe(true);
    expect(hidden('pl-2')).toBe(true);
  });

  it('shows all rows again when the query is cleared', async () => {
    await search('blinding');
    expect(hidden('pl-2')).toBe(true);
    await search('');
    expect(hidden('pl-1')).toBe(false);
    expect(hidden('pl-2')).toBe(false);
    expect(hidden('pl-3')).toBe(false);
  });
});
