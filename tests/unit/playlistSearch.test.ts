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

/**
 * The track index loads once, on first search, over every playlist on the page - the only network
 * call this feature makes, and the answer does not change while the page is open.
 */
describe('playlist search: loading the track index once', () => {
  async function boot(html: string) {
    vi.useFakeTimers();
    (globalThis as { Logger?: unknown }).Logger = { error: vi.fn(), warn: vi.fn() };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tracks: TRACKS, failed: [] }),
    }) as typeof fetch;
    document.body.innerHTML = `<input id="playlistSearch" type="text" />${html}`;
    await loadModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }

  afterEach(() => vi.useRealTimers());

  /**
   * A second search reuses what the first loaded. (The load is guarded twice over - the keyup
   * handler skips it once tracks exist, and loadSpotifyTracks itself returns early - so a single
   * mutation to either guard leaves the behaviour unchanged, which is why those two survive as
   * equivalent mutants. What this pins is the behaviour they jointly produce.)
   */
  it('does not fetch the index again once it is loaded', async () => {
    await boot(`<div id="playlists-content">${row('pl-1', 'Blinding Lights Mix')}</div>`);

    await search('lights'); // first search loads the index
    // Forget that legitimate first fetch, then assert the second search adds no new one - robust to
    // any fetch a preceding test may have left on the shared mock.
    vi.mocked(globalThis.fetch).mockClear();

    await search('mix');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // The length===0 guard: nothing to index means no request. Proven - removing it fails this.
  it('does not fetch when the page has no playlists to index', async () => {
    await boot('<div id="playlists-content"></div>');
    vi.mocked(globalThis.fetch).mockClear();

    await search('anything');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Playlists are counted by querySelectorAll('.playlist-item'); an element that merely carries a
  // data-playlist-id (a nested control) is not a row and must not make the page fetch an index.
  it('counts only .playlist-item elements, not everything with a playlist id', async () => {
    await boot(`<div id="playlists-content"><button data-playlist-id="pl-1">x</button></div>`);
    vi.mocked(globalThis.fetch).mockClear();

    await search('anything');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

/**
 * Search does not only read the playlist title and the lazy-loaded track index - it also reads the
 * song and video rows already rendered inside an expanded playlist. None of that was exercised: the
 * fixtures were title-only, so the whole `.track-item`/`.video-title` branch of getPlaylistSearchText
 * had never run.
 */
describe('playlist search: matching the rows rendered inside a playlist', () => {
  async function boot(html: string) {
    vi.useFakeTimers();
    (globalThis as { Logger?: unknown }).Logger = { error: vi.fn(), warn: vi.fn() };
    // Empty index: this suite is about the rendered rows, not the lazy-loaded track names.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tracks: {}, failed: [] }),
    }) as typeof fetch;
    document.body.innerHTML = `<input id="playlistSearch" type="text" /><div id="playlists-content">${html}</div>`;
    await loadModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }

  afterEach(() => vi.useRealTimers());

  const withTitleOnly = (id: string) =>
    `<div class="playlist-item" data-playlist-id="${id}"><h5 class="playlist-title">Plain</h5></div>`;

  it('matches a song name rendered in an expanded playlist', async () => {
    await boot(
      `<div class="playlist-item" data-playlist-id="pl-1"><h5 class="playlist-title">Some Mix</h5>` +
        `<div class="track-item">Paranoid Android</div></div>` +
        withTitleOnly('pl-2'),
    );

    await search('paranoid'); // only in pl-1's rendered track row, not in any title

    expect(hidden('pl-1')).toBe(false);
    expect(hidden('pl-2')).toBe(true);
  });

  it('matches a video title rendered in the playlist', async () => {
    await boot(
      `<div class="playlist-item" data-playlist-id="pl-1"><h5 class="playlist-title">Some Mix</h5>` +
        `<span class="video-title">Karma Police (Live)</span></div>` +
        withTitleOnly('pl-2'),
    );

    await search('karma');

    expect(hidden('pl-1')).toBe(false);
    expect(hidden('pl-2')).toBe(true);
  });

  it('matches a video whose title is only in the data-video-title attribute', async () => {
    await boot(
      `<div class="playlist-item" data-playlist-id="pl-1"><h5 class="playlist-title">Some Mix</h5>` +
        `<div data-video-title="No Surprises"></div></div>` +
        withTitleOnly('pl-2'),
    );

    await search('surprises'); // no textContent, so the dataset fallback is the only source

    expect(hidden('pl-1')).toBe(false);
    expect(hidden('pl-2')).toBe(true);
  });
});
