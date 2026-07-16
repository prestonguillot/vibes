/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/videoModal.js, covering the two halves of a video replace:
 *
 * - While the POST is in flight every way out of the modal is sealed. Abandoning the request
 *   mid-write leaves the YouTube playlist half-updated, so Cancel/X (via hx-disabled-elt),
 *   Escape and backdrop-click must all be inert until it settles - and live again afterwards.
 * - Once it succeeds the details panel is re-read until it actually shows the picked video.
 *   YouTube is eventually consistent, so a read taken straight after the write can still paint
 *   the old thumbnail; each read is verified and retried rather than fired blind.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import ejs from 'ejs';
import { trackListeners } from '@tests/helpers/clientListeners';

const CONFIRM_ID = 'confirm-selection-btn';

let listeners: ReturnType<typeof trackListeners>;

const PLAYLIST_ID = 'p1';
const NEW_VIDEO = 'NEW12345678';
const OLD_VIDEO = 'OLD87654321';

/**
 * The details panel as the server renders it: rows carry their video id in the watch URL.
 *
 * It takes a list because a replace is two writes that do not land together - between the insert
 * and the delete propagating, YouTube reports BOTH videos, which is the state the panel used to
 * accept as settled.
 */
const panelHtml = (videoIds: string | string[]) => `
  <div class="playlist-details" data-playlist-id="${PLAYLIST_ID}">
    <button type="button" data-refresh-playlist="${PLAYLIST_ID}"
            hx-get="/api/playlistDetails/playlist/${PLAYLIST_ID}">Refresh</button>
    ${[videoIds]
      .flat()
      .map((id) => `<img data-video-url="https://www.youtube.com/watch?v=${id}">`)
      .join('')}
  </div>`;

async function setup({ panelOpen = true, currentVideoId = OLD_VIDEO } = {}) {
  document.body.innerHTML = `
    <dialog id="videoSelectionModal">
      <div id="video-modal-content">
        <button type="button" class="btn-close" data-dialog-close></button>
        <button type="button" data-dialog-close>Cancel</button>
        <form id="video-selection-form">
          <input type="hidden" name="currentVideoId" value="${currentVideoId}">
        </form>
        <input type="hidden" id="hidden-new-video-id" value="${NEW_VIDEO}">
        <button type="button" id="${CONFIRM_ID}" data-playlist-id="${PLAYLIST_ID}">Confirm Selection</button>
      </div>
    </dialog>
    <div class="playlist-details-container">${panelOpen ? panelHtml(OLD_VIDEO) : ''}</div>`;

  const logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  (window as any).Logger = logger;

  listeners = trackListeners(document);
  // Imported, not eval'd: v8 attributes coverage to a FILE, and eval'd code has none - so an
  // eval'd module stays invisible to the report however well it is tested. resetModules re-runs it
  // per test, which is what the eval gave us.
  vi.resetModules();
  await import('../../public/js/videoModal.js');
  listeners.stop();

  const dialog = document.getElementById('videoSelectionModal') as HTMLDialogElement;
  // happy-dom implements <dialog>, but keep open state explicit and independent of showModal().
  dialog.setAttribute('open', '');
  Object.defineProperty(dialog, 'open', { value: true, writable: true, configurable: true });
  dialog.close = vi.fn(() => {
    (dialog as any).open = false;
  }) as unknown as HTMLDialogElement['close'];

  return { dialog, logger, confirm: document.getElementById(CONFIRM_ID) as HTMLButtonElement };
}

/**
 * Stand in for htmx on the refresh control: each click swaps the panel with the next scripted
 * server response and fires htmx:afterSwap, the signal videoModal.js waits on. The last entry
 * repeats, so a one-element script means "YouTube never catches up".
 */
function fakeHtmxRefresh(responses: Array<string | string[]>, { swaps = true } = {}) {
  const container = document.querySelector('.playlist-details-container') as HTMLElement;
  let reads = 0;

  container.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('[data-refresh-playlist]')) return;
    const videoId = responses[Math.min(reads, responses.length - 1)]!;
    reads += 1;
    if (!swaps) return; // a read that never lands
    container.innerHTML = panelHtml(videoId);
    container.dispatchEvent(
      new CustomEvent('htmx:afterSwap', { detail: { target: container }, bubbles: true }),
    );
  });

  return () => reads;
}

/** Fire the htmx lifecycle events videoModal.js listens for. */
const startConfirm = (elt: Element) =>
  document.dispatchEvent(
    new CustomEvent('htmx:beforeRequest', { detail: { elt, target: elt }, bubbles: true }),
  );
const settleConfirm = (elt: Element, successful: boolean) =>
  document.dispatchEvent(
    new CustomEvent('htmx:afterRequest', { detail: { elt, successful }, bubbles: true }),
  );

const clickBackdrop = (dialog: HTMLDialogElement) =>
  dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));

const pressEscape = (dialog: HTMLDialogElement) => {
  const event = new Event('cancel', { cancelable: true });
  dialog.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => listeners?.removeAll());

describe('videoModal exit paths during a replace', () => {
  it('ignores a backdrop click while the replace is in flight', async () => {
    const { dialog, confirm } = await setup();
    startConfirm(confirm);

    clickBackdrop(dialog);

    expect(dialog.close).not.toHaveBeenCalled();
  });

  it('ignores Escape while the replace is in flight', async () => {
    const { dialog, confirm } = await setup();
    startConfirm(confirm);

    expect(pressEscape(dialog).defaultPrevented).toBe(true);
  });

  it('allows a backdrop click again once the replace fails', async () => {
    const { dialog, confirm } = await setup();
    startConfirm(confirm);
    settleConfirm(confirm, false);

    clickBackdrop(dialog);

    expect(dialog.close).toHaveBeenCalled();
  });

  it('allows Escape again once the replace fails', async () => {
    const { dialog, confirm } = await setup();
    startConfirm(confirm);
    settleConfirm(confirm, false);

    expect(pressEscape(dialog).defaultPrevented).toBe(false);
  });

  it('leaves the backdrop click working when no replace is running', async () => {
    const { dialog } = await setup();

    clickBackdrop(dialog);

    expect(dialog.close).toHaveBeenCalled();
  });

  it('restores the Confirm label after a failed replace so it can be retried', async () => {
    const { confirm } = await setup();
    startConfirm(confirm);
    expect(confirm.innerHTML).toContain('spinner-border');

    settleConfirm(confirm, false);

    expect(confirm.innerHTML).toBe('Confirm Selection');
    expect(confirm.classList.contains('processing-state')).toBe(false);
  });
});

describe('refreshing the details panel after a replace', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Drive a successful replace and let every scheduled read/backoff run to completion. */
  async function replaceAndSettle(confirm: HTMLButtonElement) {
    startConfirm(confirm);
    settleConfirm(confirm, true);
    await vi.advanceTimersByTimeAsync(120_000);
  }

  it('reads once when YouTube already shows the new video', async () => {
    const { confirm, logger } = await setup();
    const reads = fakeHtmxRefresh([NEW_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('re-reads until a stale YouTube catches up, then stops', async () => {
    const { confirm, logger } = await setup();
    // The first two reads still describe the pre-write playlist.
    const reads = fakeHtmxRefresh([OLD_VIDEO, OLD_VIDEO, NEW_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(3);
    expect(document.querySelector(`[data-video-url*="${NEW_VIDEO}"]`)).not.toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('gives up loudly, and bounded, when the new video never appears', async () => {
    const { confirm, logger } = await setup();
    const reads = fakeHtmxRefresh([OLD_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(4); // three backoff waits => four reads
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('never caught up'),
      expect.objectContaining({ videoId: NEW_VIDEO, reads: 4 }),
    );
  });

  /**
   * A replace is an insert and a delete, and YouTube lands them apart. The insert shows up almost
   * at once; the delete can lag seconds. A read taken in between lists BOTH videos - and the panel
   * then paints the video that was just removed as YouTube-only and calls the playlist out of
   * sync, which is exactly what a user saw and had to fix with a manual refresh.
   */
  describe('when the delete has not landed yet', () => {
    it('keeps re-reading while YouTube still lists the replaced video', async () => {
      const { confirm } = await setup();
      // Both videos, then both again, then the delete finally lands.
      const reads = fakeHtmxRefresh([[NEW_VIDEO, OLD_VIDEO], [NEW_VIDEO, OLD_VIDEO], [NEW_VIDEO]]);

      await replaceAndSettle(confirm);

      expect(reads()).toBe(3);
      expect(document.querySelector(`[data-video-url*="${OLD_VIDEO}"]`)).toBeNull();
    });

    it('does not settle on the first read just because the new video arrived', async () => {
      const { confirm } = await setup();
      const reads = fakeHtmxRefresh([[NEW_VIDEO, OLD_VIDEO]]);

      await replaceAndSettle(confirm);

      // Never settles: four reads, and it says which half YouTube is still hiding.
      expect(reads()).toBe(4);
    });

    it('names which half of the write is still missing when it gives up', async () => {
      const { confirm, logger } = await setup();
      fakeHtmxRefresh([[NEW_VIDEO, OLD_VIDEO]]);

      await replaceAndSettle(confirm);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('never caught up'),
        expect.objectContaining({ newVideoShown: true, oldVideoStillShown: true }),
      );
    });

    // An unlinked track has nothing to replace, so there is no departure to wait for.
    it('settles as soon as the video arrives when there was nothing to replace', async () => {
      const { confirm } = await setup({ currentVideoId: '' });
      const reads = fakeHtmxRefresh([[NEW_VIDEO]]);

      await replaceAndSettle(confirm);

      expect(reads()).toBe(1);
    });
  });

  it('reports a read that never lands instead of blaming stale data', async () => {
    const { confirm, logger } = await setup();
    const reads = fakeHtmxRefresh([NEW_VIDEO], { swaps: false });

    await replaceAndSettle(confirm);

    expect(reads()).toBe(4);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('never swapped in'),
      expect.objectContaining({ playlistId: PLAYLIST_ID }),
    );
  });

  it('stays quiet when the details panel is not open', async () => {
    const { confirm, logger } = await setup({ panelOpen: false });
    const reads = fakeHtmxRefresh([NEW_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('details panel is not open'),
      expect.objectContaining({ playlistId: PLAYLIST_ID }),
    );
  });

  it('does not refresh at all when the replace failed', async () => {
    const { confirm } = await setup();
    const reads = fakeHtmxRefresh([NEW_VIDEO]);

    startConfirm(confirm);
    settleConfirm(confirm, false);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(reads()).toBe(0);
  });

  it('closes the modal on a successful replace', async () => {
    const { confirm, dialog } = await setup();
    fakeHtmxRefresh([NEW_VIDEO]);

    await replaceAndSettle(confirm);

    expect(dialog.close).toHaveBeenCalled();
  });

  // Without a playlist id the button cannot say which panel to refresh - it must say so, not refresh.
  it('cannot refresh, and says so, when the confirm button has no playlist id', async () => {
    const { confirm, logger } = await setup();
    confirm.removeAttribute('data-playlist-id');
    const reads = fakeHtmxRefresh([NEW_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('no playlist id'));
  });

  // If no pick was captured there is nothing to verify the refresh against - say so rather than
  // refreshing blind.
  it('cannot verify the refresh, and says so, when no video id was captured', async () => {
    const { confirm, logger } = await setup();
    (document.getElementById('hidden-new-video-id') as HTMLInputElement).value = '';
    const reads = fakeHtmxRefresh([NEW_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('no video id was captured'),
      expect.objectContaining({ playlistId: PLAYLIST_ID }),
    );
  });

  // afterRequest fires for every htmx request on the page; only the confirm button's own is ours.
  it('ignores an afterRequest fired for a different element', async () => {
    const { logger } = await setup();
    const reads = fakeHtmxRefresh([NEW_VIDEO]);
    const other = document.createElement('button');
    other.id = 'not-the-confirm-button';
    document.body.appendChild(other);

    settleConfirm(other, true);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(reads()).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('video-selection-modal template', () => {
  async function renderModal() {
    return ejs.renderFile(path.join(__dirname, '../../views/partials/video-selection-modal.ejs'), {
      modalTitle: 'Pick a video',
      instructionText: 'Choose one',
      trackId: 't1',
      trackName: 'Song',
      artistName: 'Artist',
      playlistId: 'p1',
      currentVideoId: 'v1',
      searchQuery: 'Song Artist',
      videos: [],
    });
  }

  it('disables Confirm, Cancel and X for the duration of the replace request', async () => {
    document.body.innerHTML = `<dialog id="videoSelectionModal"><div id="video-modal-content">${await renderModal()}</div></dialog>`;

    const selector = document.getElementById(CONFIRM_ID)!.getAttribute('hx-disabled-elt') as string;

    // htmx resolves each comma-separated part; plain CSS parts are joined and passed to
    // querySelectorAll. `this` is NOT a part htmx understands - it would resolve as a CSS type
    // selector and silently match nothing - so the Confirm button is named explicitly.
    expect(selector).not.toMatch(/(^|,)\s*this\s*(,|$)/);

    const disabled = [...document.querySelectorAll(selector)];
    expect(disabled).toContain(document.getElementById(CONFIRM_ID));
    expect(disabled).toEqual(
      expect.arrayContaining([
        ...document.querySelectorAll('#videoSelectionModal [data-dialog-close]'),
      ]),
    );
    expect(disabled).toHaveLength(3);
  });

  it('does not reach close controls outside the video modal', async () => {
    document.body.innerHTML = `
      <dialog id="errorModal"><button data-dialog-close id="other-closer"></button></dialog>
      <dialog id="videoSelectionModal"><div id="video-modal-content">${await renderModal()}</div></dialog>`;

    const selector = document.getElementById(CONFIRM_ID)!.getAttribute('hx-disabled-elt') as string;

    expect([...document.querySelectorAll(selector)]).not.toContain(
      document.getElementById('other-closer'),
    );
  });
});

/**
 * The picker itself - choosing a video, and what happens when a fresh search replaces the options.
 *
 * Never executed at all: 71 of this file's mutants sit in here. The tests above cover the exits and
 * the refresh, which is the dangerous half; this is the half the user actually touches.
 */
describe('videoModal: picking a video', () => {
  /** The modal as the server renders it: a radio per candidate, Confirm disabled until one is on. */
  const results = (ids: string[]) =>
    ids
      .map(
        (id) =>
          `<label><input type="radio" name="newVideoId" class="video-option-radio" value="${id}"></label>`,
      )
      .join('');

  async function modal({ videos = ['v1', 'v2'] } = {}) {
    document.body.innerHTML = `
      <dialog id="videoSelectionModal">
        <div id="video-modal-content">
          <form id="video-selection-form">
            <input type="hidden" name="currentVideoId" value="${OLD_VIDEO}">
          </form>
          <input type="hidden" id="hidden-new-video-id" value="">
          <div id="video-results-list">${results(videos)}</div>
          <button type="button" id="${CONFIRM_ID}" data-playlist-id="${PLAYLIST_ID}" disabled>Confirm</button>
        </div>
      </dialog>`;

    (window as any).Logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    listeners = trackListeners(document);
    vi.resetModules();
    await import('../../public/js/videoModal.js');
    listeners.stop();
  }

  /** htmx swapped something in; the module re-wires off this. */
  const afterSwap = (targetId: string) => {
    const target = document.getElementById(targetId)!;
    document.dispatchEvent(
      new CustomEvent('htmx:afterSwap', { detail: { target }, bubbles: true }),
    );
  };

  const confirmBtn = () => document.getElementById(CONFIRM_ID) as HTMLButtonElement;
  const pick = (value: string) => {
    const radio = document.querySelector(
      `.video-option-radio[value="${value}"]`,
    ) as HTMLInputElement;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('arms Confirm once a video is chosen', async () => {
    await modal();
    afterSwap('video-modal-content');
    expect(confirmBtn().disabled).toBe(true);

    pick('v2');

    expect(confirmBtn().disabled).toBe(false);
  });

  it('remembers which video was chosen', async () => {
    await modal();
    afterSwap('video-modal-content');

    pick('v2');

    expect((document.getElementById('hidden-new-video-id') as HTMLInputElement).value).toBe('v2');
  });

  it('takes the last choice when the user changes their mind', async () => {
    await modal();
    afterSwap('video-modal-content');

    pick('v1');
    pick('v2');

    expect((document.getElementById('hidden-new-video-id') as HTMLInputElement).value).toBe('v2');
  });

  // A re-search replaces the options: the old pick refers to a video that is no longer on screen,
  // and confirming it would replace the track with something the user can no longer see.
  it('drops the earlier pick when a fresh search replaces the options', async () => {
    await modal();
    afterSwap('video-modal-content');
    pick('v2');
    expect(confirmBtn().disabled).toBe(false);

    document.getElementById('video-results-list')!.innerHTML = results(['v9']);
    afterSwap('video-results-list');

    expect((document.getElementById('hidden-new-video-id') as HTMLInputElement).value).toBe('');
    expect(confirmBtn().disabled).toBe(true);
  });

  it('wires the new options up after a re-search', async () => {
    await modal();
    afterSwap('video-modal-content');

    document.getElementById('video-results-list')!.innerHTML = results(['v9']);
    afterSwap('video-results-list');
    pick('v9');

    expect((document.getElementById('hidden-new-video-id') as HTMLInputElement).value).toBe('v9');
    expect(confirmBtn().disabled).toBe(false);
  });

  it('ignores a swap of something else entirely', async () => {
    await modal();
    const other = document.createElement('div');
    other.id = 'something-else';
    document.body.appendChild(other);

    afterSwap('something-else');
    pick('v1');

    // Never wired, so choosing does nothing.
    expect(confirmBtn().disabled).toBe(true);
  });

  /**
   * A fresh search replaces the options list with different videos. The pick made against the old
   * list is meaningless now - the id it points at may not even be on screen - so it is dropped and
   * Confirm goes back to disabled. Leaving it armed would let the user confirm a video they can no
   * longer see.
   */
  describe('when a re-search replaces the results', () => {
    const reSearch = async (videos: string[]) => {
      document.getElementById('video-results-list')!.innerHTML = results(videos);
      afterSwap('video-results-list');
    };

    it('drops the pick made against the old results', async () => {
      await modal();
      afterSwap('video-modal-content');
      pick('v1');

      await reSearch(['v8', 'v9']);

      expect((document.getElementById('hidden-new-video-id') as HTMLInputElement).value).toBe('');
      expect(confirmBtn().disabled).toBe(true);
    });

    it('arms Confirm again on a pick from the new results', async () => {
      await modal();
      afterSwap('video-modal-content');
      pick('v1');

      await reSearch(['v8', 'v9']);
      pick('v9');

      expect((document.getElementById('hidden-new-video-id') as HTMLInputElement).value).toBe('v9');
      expect(confirmBtn().disabled).toBe(false);
    });

    // A full-modal swap is the modal opening fresh; there is no earlier pick to drop, and clearing
    // would fight the server's own rendering of the current selection.
    it('does not clear the pick when the whole modal is swapped', async () => {
      await modal();
      afterSwap('video-modal-content');
      pick('v1');

      afterSwap('video-modal-content');

      expect((document.getElementById('hidden-new-video-id') as HTMLInputElement).value).toBe('v1');
    });
  });
});

/**
 * The modal opens on htmx:beforeRequest rather than when the search returns, so it appears the
 * instant the user clicks rather than after a scrape that takes seconds. That means the loading
 * state and the open have to happen before there is any content to show.
 */
describe('opening the picker', () => {
  const setupModal = async ({ open = false } = {}) => {
    document.body.innerHTML = `
      <dialog id="videoSelectionModal">
        <div id="video-modal-content"><span class="spinner">Loading…</span></div>
      </dialog>`;
    (window as any).Logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    listeners = trackListeners(document);
    vi.resetModules();
    await import('../../public/js/videoModal.js');
    listeners.stop();

    const dialog = document.getElementById('videoSelectionModal') as HTMLDialogElement;
    Object.defineProperty(dialog, 'open', { value: open, writable: true, configurable: true });
    dialog.showModal = vi.fn(() => {
      (dialog as unknown as { open: boolean }).open = true;
    }) as unknown as HTMLDialogElement['showModal'];
    return dialog;
  };

  const beforeRequest = (targetId: string) =>
    document.dispatchEvent(
      new CustomEvent('htmx:beforeRequest', {
        detail: { elt: document.body, target: document.getElementById(targetId) },
        bubbles: true,
      }),
    );

  it('opens as soon as the search starts, not when it returns', async () => {
    const dialog = await setupModal();

    beforeRequest('video-modal-content');

    expect(dialog.showModal).toHaveBeenCalled();
  });

  // The markup captured at load is the spinner the server rendered; it is put back so every open
  // starts from the loading state rather than the previous track's results.
  it('shows the loading state while the search runs', async () => {
    await setupModal();
    document.getElementById('video-modal-content')!.innerHTML = '<p>last search results</p>';

    beforeRequest('video-modal-content');

    expect(document.getElementById('video-modal-content')!.innerHTML).toContain('Loading');
  });

  // showModal() on an already-open dialog throws InvalidStateError.
  it('does not re-open a dialog that is already open', async () => {
    const dialog = await setupModal({ open: true });

    beforeRequest('video-modal-content');

    expect(dialog.showModal).not.toHaveBeenCalled();
  });

  it('ignores a request aimed at anything else', async () => {
    const dialog = await setupModal();
    const other = document.createElement('div');
    other.id = 'unrelated';
    document.body.appendChild(other);

    beforeRequest('unrelated');

    expect(dialog.showModal).not.toHaveBeenCalled();
    expect(document.getElementById('video-modal-content')!.innerHTML).toContain('Loading');
  });

  const afterSwap = (targetId: string) =>
    document.dispatchEvent(
      new CustomEvent('htmx:afterSwap', {
        detail: { target: document.getElementById(targetId) },
        bubbles: true,
      }),
    );

  // The full modal markup arriving is the other way the picker opens (the request having returned).
  it('opens the modal when the full modal content is swapped in', async () => {
    const dialog = await setupModal();

    afterSwap('video-modal-content');

    expect(dialog.showModal).toHaveBeenCalled();
  });

  it('does not re-open on a full-modal swap when the modal is already open', async () => {
    const dialog = await setupModal({ open: true });

    afterSwap('video-modal-content');

    expect(dialog.showModal).not.toHaveBeenCalled();
  });

  // A manual re-search swaps only the results list - the modal is already open and must NOT be
  // re-opened (showModal on an open dialog throws).
  it('does not open the modal on a results-only swap', async () => {
    const dialog = await setupModal({ open: true });
    const results = document.createElement('div');
    results.id = 'video-results-list';
    document.body.appendChild(results);

    afterSwap('video-results-list');

    expect(dialog.showModal).not.toHaveBeenCalled();
  });

  // With the dialog gone (panel torn down mid-flight), a full-modal swap must say so, not throw.
  it('logs an error, without throwing, when the modal element is missing on a full-modal swap', async () => {
    await setupModal();
    // Move the swap target out of the dialog, then remove the dialog itself.
    document.body.appendChild(document.getElementById('video-modal-content')!);
    document.getElementById('videoSelectionModal')!.remove();

    expect(() => afterSwap('video-modal-content')).not.toThrow();
    expect(
      (window as unknown as { Logger: { error: ReturnType<typeof vi.fn> } }).Logger.error,
    ).toHaveBeenCalledWith('Video selection modal element not found');
  });

  // The beforeRequest opener reads modalEl the same way; a missing dialog must not crash the request.
  it('does not crash on a beforeRequest when the dialog is gone', async () => {
    await setupModal();
    document.body.appendChild(document.getElementById('video-modal-content')!);
    document.getElementById('videoSelectionModal')!.remove();

    expect(() => beforeRequest('video-modal-content')).not.toThrow();
  });
});

/**
 * Cancel and the X - the ordinary way out. Nothing executed this at all: the in-flight tests seal
 * Escape and the backdrop, but the close buttons are handled here, and hx-disabled-elt is what
 * seals THEM during a replace. So this is the path a user takes every time they open the picker and
 * change their mind, and it was running unmeasured.
 */
describe('closing the picker with Cancel or the X', () => {
  const setupClosers = async () => {
    document.body.innerHTML = `
      <dialog id="videoSelectionModal">
        <div id="video-modal-content">
          <button type="button" class="btn-close" data-dialog-close></button>
          <button type="button" data-dialog-close><span id="cancel-label">Cancel</span></button>
        </div>
      </dialog>
      <button type="button" id="outside" data-dialog-close>Not in a dialog</button>`;
    (window as any).Logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    listeners = trackListeners(document);
    vi.resetModules();
    await import('../../public/js/videoModal.js');
    listeners.stop();

    const dialog = document.getElementById('videoSelectionModal') as HTMLDialogElement;
    Object.defineProperty(dialog, 'open', { value: true, writable: true, configurable: true });
    dialog.close = vi.fn(() => {
      (dialog as unknown as { open: boolean }).open = false;
    }) as unknown as HTMLDialogElement['close'];
    return dialog;
  };

  const clickOn = (selector: string) =>
    document.querySelector(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  it.each([['.btn-close'], ['[data-dialog-close]:not(.btn-close)']])(
    'closes when %s is clicked',
    async (selector) => {
      const dialog = await setupClosers();

      clickOn(selector);

      expect(dialog.close).toHaveBeenCalled();
    },
  );

  // The click lands on the label inside the button, not the button itself - closest() is what makes
  // that work, and without it the user's click does nothing.
  it('closes when the click lands on a child of the button', async () => {
    const dialog = await setupClosers();

    clickOn('#cancel-label');

    expect(dialog.close).toHaveBeenCalled();
  });

  it('does nothing when the click is not on a closer', async () => {
    const dialog = await setupClosers();

    clickOn('#video-modal-content');

    expect(dialog.close).not.toHaveBeenCalled();
  });

  // close() on a dialog that is not open is a no-op, but calling it says this does not know what
  // state it is in.
  it('does not close a dialog that is already closed', async () => {
    const dialog = await setupClosers();
    (dialog as unknown as { open: boolean }).open = false;

    clickOn('.btn-close');

    expect(dialog.close).not.toHaveBeenCalled();
  });

  it('ignores a closer that is not inside a dialog', async () => {
    const dialog = await setupClosers();

    clickOn('#outside');

    expect(dialog.close).not.toHaveBeenCalled();
  });
});
