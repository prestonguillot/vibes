/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/indexPage.js: the OAuth error dialog and opening video thumbnails.
 * Shipped on every page load via index.ejs, and at 0% coverage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackListeners } from '@tests/helpers/clientListeners';

let listeners: ReturnType<typeof trackListeners>;

async function load(search = '') {
  window.history.replaceState({}, '', `/${search}`);
  listeners = trackListeners(document, document.body);
  vi.resetModules();
  await import('../../public/js/indexPage.js');
  listeners.stop();
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

const renderDialog = () => {
  document.body.innerHTML = `
    <dialog id="connectionErrorModal">
      <h5 id="connectionErrorLabel"></h5>
      <p id="connectionErrorMessage"></p>
    </dialog>`;
  const dialog = document.getElementById('connectionErrorModal') as HTMLDialogElement;
  dialog.showModal = vi.fn();
  return dialog;
};

const message = () => document.getElementById('connectionErrorMessage')!.textContent;
const label = () => document.getElementById('connectionErrorLabel')!.textContent;

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  vi.stubGlobal('open', vi.fn());
});

afterEach(() => {
  listeners?.removeAll();
  vi.unstubAllGlobals();
});

describe('indexPage.js: the OAuth error dialog', () => {
  it('stays shut when there is no error in the URL', async () => {
    const dialog = renderDialog();

    await load('');

    expect(dialog.showModal).not.toHaveBeenCalled();
  });

  it('opens with the service named when an error arrives', async () => {
    const dialog = renderDialog();

    await load('?error=spotify');

    expect(dialog.showModal).toHaveBeenCalled();
    expect(label()).toBe('Spotify Connection Failed');
  });

  it.each([
    ['quota_exceeded', 'Spotify API quota exceeded. Please wait and try again later.'],
    ['rate_limited', 'Rate limited by Spotify. Please wait a moment and try again.'],
    ['auth_error', 'Spotify authentication failed. Please try reconnecting.'],
    ['service_unavailable', 'Spotify service is temporarily unavailable. Please try again soon.'],
  ])('explains reason=%s', async (reason, expected) => {
    renderDialog();

    await load(`?error=spotify&reason=${reason}`);

    expect(message()).toBe(expected);
  });

  it('falls back to a generic message for an unknown reason', async () => {
    renderDialog();

    await load('?error=spotify&reason=something_new');

    expect(message()).toBe('Connection failed. Please try again.');
  });

  it('capitalises the service name', async () => {
    renderDialog();

    await load('?error=youtube&reason=auth_error');

    expect(label()).toBe('Youtube Connection Failed');
    expect(message()).toContain('Youtube');
  });

  // Otherwise a refresh re-shows the error for a connection that has since succeeded.
  it('scrubs the error out of the URL after showing it', async () => {
    renderDialog();

    await load('?error=spotify&reason=auth_error');

    expect(window.location.search).toBe('');
  });
});

describe('indexPage.js: opening a video thumbnail', () => {
  const renderThumbnail = (over: { url?: string | null } = {}) => {
    const url = over.url === undefined ? 'https://www.youtube.com/watch?v=abc' : over.url;
    document.body.innerHTML = `
      <img id="thumb" class="youtube-video__thumbnail--clickable"
           ${url === null ? '' : `data-video-url="${url}"`} role="button" tabindex="0">
      <img id="plain" class="youtube-video__thumbnail">`;
    return document.getElementById('thumb') as HTMLElement;
  };

  // Without noopener the opened YouTube tab gets a live window.opener pointing at this app and can
  // navigate it away (reverse tabnabbing). The url comes from a data attribute on rendered DOM.
  it('opens the video in a new tab with noopener,noreferrer', async () => {
    const thumb = renderThumbnail();
    await load();

    thumb.click();

    expect(window.open).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=abc',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('ignores a click on a thumbnail that is not clickable', async () => {
    renderThumbnail();
    await load();

    document.getElementById('plain')!.click();

    expect(window.open).not.toHaveBeenCalled();
  });

  it('ignores a clickable thumbnail with no url', async () => {
    const thumb = renderThumbnail({ url: null });
    await load();

    thumb.click();

    expect(window.open).not.toHaveBeenCalled();
  });

  it.each([['Enter'], [' ']])('opens the video on %s, since it is a role=button', async (key) => {
    const thumb = renderThumbnail();
    await load();

    thumb.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

    expect(window.open).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=abc',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('does not open on other keys', async () => {
    const thumb = renderThumbnail();
    await load();

    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(window.open).not.toHaveBeenCalled();
  });

  // Space would otherwise scroll the page out from under the click.
  it('suppresses the default action when it opens from the keyboard', async () => {
    const thumb = renderThumbnail();
    await load();

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    thumb.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the default action alone when no thumbnail was opened', async () => {
    renderThumbnail({ url: null });
    await load();

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.getElementById('thumb')!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
