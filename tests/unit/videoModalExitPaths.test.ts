/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/videoModal.js: while a Confirm (video replace) POST is in flight, every
 * way out of the modal is sealed. Abandoning the request mid-write leaves the YouTube playlist
 * half-updated, so Cancel/X (via hx-disabled-elt), Escape and backdrop-click must all be inert
 * until it settles - and live again afterwards, including when the request fails.
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

function setup() {
  document.body.innerHTML = `
    <dialog id="videoSelectionModal">
      <div id="video-modal-content">
        <button type="button" class="btn-close" data-dialog-close></button>
        <button type="button" data-dialog-close>Cancel</button>
        <button type="button" id="${CONFIRM_ID}" data-playlist-id="p1">Confirm Selection</button>
      </div>
    </dialog>`;

  (window as any).Logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

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

  return { dialog, confirm: document.getElementById(CONFIRM_ID) as HTMLButtonElement };
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
