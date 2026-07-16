/**
 * Behavior tests for the client-side playlist search (public/js/playlistSearch.js).
 * Verifies the simple word-substring matching filters rows by title and by
 * lazy-loaded track names, order-independently - and resets when cleared.
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

// Imported, not eval'd: v8 attributes coverage to a FILE, and eval'd code has none - so an
// eval'd module stays invisible to the report however well it is tested. resetModules re-runs it
// per test, which is what the eval gave us.
async function loadModule() {
  vi.resetModules();
  await import('../../public/js/playlistSearch.js');
}

describe('playlist search (client-side filtering)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as { Logger?: unknown }).Logger = { error: vi.fn() };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tracks: TRACKS, failed: [] }),
    }) as typeof fetch;

    document.body.innerHTML = `
      <input id="playlistSearch" type="text" />
      <div id="playlists-content">
        ${row('pl-1', 'Blinding Lights Mix')}
        ${row('pl-2', 'Chill Vibes')}
        ${row('pl-3', 'Workout Mix')}
      </div>
    `;

    await loadModule();
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

  /**
   * EVERY word must appear, not just one. "mix workout" above matches because both words are in
   * "Workout Mix", so it cannot tell .every from .some - a row where one word matches and the other
   * does not is what does. "workout zzz" must hide the Workout row: it has "workout" but no "zzz".
   */
  it('requires every query word to match, not just one', async () => {
    await search('workout zzz');
    expect(hidden('pl-3')).toBe(true); // has "workout", lacks "zzz"
  });

  // The query and the text are both lowered before comparing, so casing on either side is ignored.
  it('matches regardless of the case typed', async () => {
    await search('BLINDING');
    expect(hidden('pl-1')).toBe(false);
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

/**
 * The rest of what the box does. The four tests above cover matching; these cover everything the
 * user sees around it - the empty state, Escape, and what happens when the list is swapped out from
 * under an active search - none of which anything looked at.
 */
describe('playlist search: the no-results message', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as { Logger?: unknown }).Logger = { error: vi.fn() };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tracks: TRACKS, failed: [] }),
    }) as typeof fetch;
    document.body.innerHTML = `
      <input id="playlistSearch" type="text" />
      <div id="playlists-content">
        ${row('pl-1', 'Blinding Lights Mix')}
        ${row('pl-2', 'Chill Vibes')}
      </div>`;
    await loadModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  });

  afterEach(() => vi.useRealTimers());

  const message = () => document.querySelector('.no-search-results') as HTMLElement | null;

  it('says so, and quotes the query, when nothing matches', async () => {
    await search('nothing here matches this');

    expect(message()).not.toBeNull();
    expect(message()!.textContent).toBe('No playlists found matching "nothing here matches this"');
    expect(message()!.classList.contains('hidden')).toBe(false);
  });

  it('says nothing when something matches', async () => {
    await search('blinding');

    expect(message()).toBeNull();
  });

  // An empty box is not "no results", it is no search - every row is showing.
  it('says nothing for an empty query, even though nothing was searched', async () => {
    await search('');

    expect(message()).toBeNull();
  });

  it('hides the message again once a query matches', async () => {
    await search('nothing here matches this');
    expect(message()!.classList.contains('hidden')).toBe(false);

    await search('blinding');

    expect(message()!.classList.contains('hidden')).toBe(true);
  });

  // Re-used rather than piled up: searching for three misses in a row must not leave three alerts.
  it('reuses the one message rather than adding another each time', async () => {
    await search('no match one');
    await search('no match two');
    await search('no match three');

    expect(document.querySelectorAll('.no-search-results')).toHaveLength(1);
  });
});

describe('playlist search: Escape', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as { Logger?: unknown }).Logger = { error: vi.fn() };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tracks: TRACKS, failed: [] }),
    }) as typeof fetch;
    document.body.innerHTML = `
      <input id="playlistSearch" type="text" />
      <div id="playlists-content">
        ${row('pl-1', 'Blinding Lights Mix')}
        ${row('pl-2', 'Chill Vibes')}
      </div>`;
    await loadModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  });

  afterEach(() => vi.useRealTimers());

  const press = async (key: string) => {
    const input = document.getElementById('playlistSearch') as HTMLInputElement;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key }));
    await vi.runAllTimersAsync();
  };

  it('empties the box and shows everything again', async () => {
    await search('blinding');
    expect(hidden('pl-2')).toBe(true);

    await press('Escape');

    expect((document.getElementById('playlistSearch') as HTMLInputElement).value).toBe('');
    expect(hidden('pl-1')).toBe(false);
    expect(hidden('pl-2')).toBe(false);
  });

  it('leaves the search alone on any other key', async () => {
    await search('blinding');

    await press('a');

    expect((document.getElementById('playlistSearch') as HTMLInputElement).value).toBe('blinding');
    expect(hidden('pl-2')).toBe(true);
  });
});

/**
 * The list is re-rendered whole by htmx - a refresh, a sync, the own-only toggle. The new rows have
 * never been filtered, so an active search has to be re-applied or a search silently stops being
 * one; and the cached track names belong to the old rows, so they have to go.
 */
describe('playlist search: when the list is swapped out', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as { Logger?: unknown }).Logger = { error: vi.fn() };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tracks: TRACKS, failed: [] }),
    }) as typeof fetch;
    document.body.innerHTML = `
      <input id="playlistSearch" type="text" />
      <div id="playlists-content">
        ${row('pl-1', 'Blinding Lights Mix')}
        ${row('pl-2', 'Chill Vibes')}
      </div>`;
    await loadModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  });

  afterEach(() => vi.useRealTimers());

  const swap = async () => {
    const target = document.getElementById('playlists-content')!;
    document.body.dispatchEvent(
      new window.CustomEvent('htmx:afterSwap', { detail: { target }, bubbles: true }),
    );
    await vi.runAllTimersAsync();
  };

  it('re-applies an active search to the rows that arrived', async () => {
    await search('blinding');

    // The swap brings rows back unfiltered, as the server renders them.
    document.getElementById('playlists-content')!.innerHTML =
      row('pl-1', 'Blinding Lights Mix') + row('pl-2', 'Chill Vibes');
    await swap();

    expect(hidden('pl-1')).toBe(false);
    expect(hidden('pl-2')).toBe(true);
  });

  it('refetches the track names, which belonged to the old rows', async () => {
    await search('tiger');
    const before = vi.mocked(globalThis.fetch).mock.calls.length;

    await swap();
    await search('tiger');

    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(before);
  });

  it('does nothing when the swap was some other part of the page', async () => {
    await search('blinding');
    const before = vi.mocked(globalThis.fetch).mock.calls.length;

    document.body.dispatchEvent(
      new window.CustomEvent('htmx:afterSwap', {
        detail: { target: document.createElement('div') },
        bubbles: true,
      }),
    );
    await vi.runAllTimersAsync();

    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);
  });
});

/**
 * What search can do right now, said out loud.
 *
 * Searching by song needs the track index; the page can only build it for playlists Spotify
 * answered for. When some are missing, a search for a song sitting in one of them matches nothing -
 * which reads as "you do not have that", not as "the box could not check". The notice is the whole
 * difference between a search that is incomplete and a search that is wrong.
 */
describe('playlist search: when the track index is incomplete', () => {
  const notice = () => document.getElementById('playlist-tracks-loading');

  async function boot(response: unknown, ok = true) {
    vi.useFakeTimers();
    (globalThis as { Logger?: unknown }).Logger = { error: vi.fn(), warn: vi.fn() };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok, json: async () => response }) as typeof fetch;
    document.body.innerHTML = `
      <input id="playlistSearch" type="text" />
      <div id="playlists-content">${row('pl-1', 'Blinding Lights Mix')}</div>`;
    await loadModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    // The index is built lazily, on the first keystroke - nothing is fetched before the user asks.
    await search('lights');
  }

  afterEach(() => vi.useRealTimers());

  it('says nothing when every playlist came back', async () => {
    await boot({ tracks: TRACKS, failed: [] });

    expect(notice()).toBeNull();
  });

  it('says so when some playlists could not be read', async () => {
    await boot({ tracks: { 'pl-1': ['Blinding Lights'] }, failed: ['pl-2', 'pl-3'] });

    expect(notice()?.textContent).toContain('2 playlists');
    expect(notice()?.className).toContain('alert-warning');
  });

  it('counts one playlist as one', async () => {
    await boot({ tracks: TRACKS, failed: ['pl-2'] });

    expect(notice()?.textContent).toContain('1 playlist -');
  });

  // The whole fetch failing is the same problem, whole: name matching still works, and that is all.
  it('says so when the index could not be built at all', async () => {
    await boot(undefined, false);

    expect(notice()?.textContent).toContain('name only');
    expect(notice()?.className).toContain('alert-warning');
  });
});
