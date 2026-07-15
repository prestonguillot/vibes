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
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';

const source = fs.readFileSync(path.join(__dirname, '../../public/js/videoModal.js'), 'utf-8');

const CONFIRM_ID = 'confirm-selection-btn';

// videoModal.js binds to `document`, which survives resetting document.body between tests. Each
// setup() would stack another copy of the handlers - and copy 2 would read the spinner markup that
// copy 1 just wrote as the "original" button label. Record the registrations and unbind them.
const documentListeners: Array<[string, EventListener]> = [];

const PLAYLIST_ID = 'p1';
const NEW_VIDEO = 'NEW12345678';
const OLD_VIDEO = 'OLD87654321';

/** The details panel as the server renders it: rows carry their video id in the watch URL. */
const panelHtml = (videoId: string) => `
  <div class="playlist-details" data-playlist-id="${PLAYLIST_ID}">
    <button type="button" data-refresh-playlist="${PLAYLIST_ID}"
            hx-get="/api/playlistDetails/playlist/${PLAYLIST_ID}">Refresh</button>
    <img data-video-url="https://www.youtube.com/watch?v=${videoId}">
  </div>`;

function setup({ panelOpen = true } = {}) {
  document.body.innerHTML = `
    <dialog id="videoSelectionModal">
      <div id="video-modal-content">
        <button type="button" class="btn-close" data-dialog-close></button>
        <button type="button" data-dialog-close>Cancel</button>
        <input type="hidden" id="hidden-new-video-id" value="${NEW_VIDEO}">
        <button type="button" id="${CONFIRM_ID}" data-playlist-id="${PLAYLIST_ID}">Confirm Selection</button>
      </div>
    </dialog>
    <div class="playlist-details-container">${panelOpen ? panelHtml(OLD_VIDEO) : ''}</div>`;

  const logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  (window as any).Logger = logger;

  const addEventListener = document.addEventListener.bind(document);
  const capture = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation((type: string, listener: EventListener, options?: unknown) => {
      documentListeners.push([type, listener]);
      addEventListener(type, listener, options as AddEventListenerOptions);
    });
  // eslint-disable-next-line no-eval
  (0, eval)(source);
  capture.mockRestore();

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
function fakeHtmxRefresh(responses: string[], { swaps = true } = {}) {
  const container = document.querySelector('.playlist-details-container') as HTMLElement;
  let reads = 0;

  container.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('[data-refresh-playlist]')) return;
    const videoId = responses[Math.min(reads, responses.length - 1)];
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

afterEach(() => {
  documentListeners.forEach(([type, listener]) => document.removeEventListener(type, listener));
  documentListeners.length = 0;
});

describe('videoModal exit paths during a replace', () => {
  it('ignores a backdrop click while the replace is in flight', () => {
    const { dialog, confirm } = setup();
    startConfirm(confirm);

    clickBackdrop(dialog);

    expect(dialog.close).not.toHaveBeenCalled();
  });

  it('ignores Escape while the replace is in flight', () => {
    const { dialog, confirm } = setup();
    startConfirm(confirm);

    expect(pressEscape(dialog).defaultPrevented).toBe(true);
  });

  it('allows a backdrop click again once the replace fails', () => {
    const { dialog, confirm } = setup();
    startConfirm(confirm);
    settleConfirm(confirm, false);

    clickBackdrop(dialog);

    expect(dialog.close).toHaveBeenCalled();
  });

  it('allows Escape again once the replace fails', () => {
    const { dialog, confirm } = setup();
    startConfirm(confirm);
    settleConfirm(confirm, false);

    expect(pressEscape(dialog).defaultPrevented).toBe(false);
  });

  it('leaves the backdrop click working when no replace is running', () => {
    const { dialog } = setup();

    clickBackdrop(dialog);

    expect(dialog.close).toHaveBeenCalled();
  });

  it('restores the Confirm label after a failed replace so it can be retried', () => {
    const { confirm } = setup();
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
    const { confirm, logger } = setup();
    const reads = fakeHtmxRefresh([NEW_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('re-reads until a stale YouTube catches up, then stops', async () => {
    const { confirm, logger } = setup();
    // The first two reads still describe the pre-write playlist.
    const reads = fakeHtmxRefresh([OLD_VIDEO, OLD_VIDEO, NEW_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(3);
    expect(document.querySelector(`[data-video-url*="${NEW_VIDEO}"]`)).not.toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('gives up loudly, and bounded, when the new video never appears', async () => {
    const { confirm, logger } = setup();
    const reads = fakeHtmxRefresh([OLD_VIDEO]);

    await replaceAndSettle(confirm);

    expect(reads()).toBe(4); // three backoff waits => four reads
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('never showed the new video'),
      expect.objectContaining({ videoId: NEW_VIDEO, reads: 4 }),
    );
  });

  it('reports a read that never lands instead of blaming stale data', async () => {
    const { confirm, logger } = setup();
    const reads = fakeHtmxRefresh([NEW_VIDEO], { swaps: false });

    await replaceAndSettle(confirm);

    expect(reads()).toBe(4);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('never swapped in'),
      expect.objectContaining({ playlistId: PLAYLIST_ID }),
    );
  });

  it('stays quiet when the details panel is not open', async () => {
    const { confirm, logger } = setup({ panelOpen: false });
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
    const { confirm } = setup();
    const reads = fakeHtmxRefresh([NEW_VIDEO]);

    startConfirm(confirm);
    settleConfirm(confirm, false);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(reads()).toBe(0);
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
