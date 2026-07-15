/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/theme.js and public/js/themeToggle.js - the light/dark theme.
 *
 * theme.js runs in <head> before first paint, so a mistake here is a visible flash of the wrong
 * theme (or, in the localStorage-throws case, the whole page failing to render its tokens).
 *
 * Both set data-theme AND data-bs-theme: the first drives our tokens, the second drives Bootstrap
 * 5.3's own dark mode (alert backgrounds, the btn-close X, form controls). Dropping either leaves
 * half the page in the wrong theme, so both are asserted throughout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackListeners } from '@tests/helpers/clientListeners';

let listeners: ReturnType<typeof trackListeners>;

const html = () => document.documentElement;
const themes = () => ({
  theme: html().getAttribute('data-theme'),
  bs: html().getAttribute('data-bs-theme'),
});

/**
 * Replace localStorage with one that throws, the way Safari's private mode does.
 *
 * It has to be stubbed WHOLESALE. happy-dom's localStorage is a Proxy: a Storage.prototype spy
 * never fires (the proxy intercepts first), and vi.spyOn(localStorage, ...) sets through the proxy
 * trap, which restoreAllMocks cannot undo - the throwing getItem then leaks into every later test.
 * stubGlobal swaps the binding and unstubAllGlobals puts it back.
 */
function breakStorage(method: 'getItem' | 'setItem') {
  const boom = () => {
    throw new Error('SecurityError: storage is disabled');
  };
  vi.stubGlobal('localStorage', {
    getItem: method === 'getItem' ? boom : () => null,
    setItem: method === 'setItem' ? boom : () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  });
}

/** Point matchMedia at a given OS preference. happy-dom does not implement it. */
function osPrefersDark(dark: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: dark }) as unknown as typeof matchMedia;
}

async function loadTheme() {
  vi.resetModules();
  await import('../../public/js/theme.js');
}

async function loadToggle() {
  listeners = trackListeners(document, document.body);
  vi.resetModules();
  await import('../../public/js/themeToggle.js');
  listeners.stop();
}

const toggleBtn = () => document.getElementById('theme-toggle') as HTMLButtonElement;
const icon = () => document.querySelector('.theme-toggle__icon') as HTMLElement;

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  html().removeAttribute('data-theme');
  html().removeAttribute('data-bs-theme');
  document.body.innerHTML = '';
  (window as unknown as { Logger: unknown }).Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  osPrefersDark(false);
});

afterEach(() => {
  listeners?.removeAll();
  vi.unstubAllGlobals();
});

describe('theme.js: pre-paint theme selection', () => {
  it('uses the saved choice over the OS setting', async () => {
    localStorage.setItem('theme', 'dark');
    osPrefersDark(false);

    await loadTheme();

    expect(themes()).toEqual({ theme: 'dark', bs: 'dark' });
  });

  it('falls back to the OS setting when nothing is saved', async () => {
    osPrefersDark(true);

    await loadTheme();

    expect(themes()).toEqual({ theme: 'dark', bs: 'dark' });
  });

  it('defaults to light when nothing is saved and the OS prefers light', async () => {
    osPrefersDark(false);

    await loadTheme();

    expect(themes()).toEqual({ theme: 'light', bs: 'light' });
  });

  it('honours a saved light choice even when the OS prefers dark', async () => {
    localStorage.setItem('theme', 'light');
    osPrefersDark(true);

    await loadTheme();

    expect(themes()).toEqual({ theme: 'light', bs: 'light' });
  });

  // It runs before anything else, in a try/catch, so a blocked localStorage must still paint.
  // A saved 'dark' plus an OS preferring dark means light is reachable ONLY through the catch:
  // if the throw is not intercepted, this lands on dark and the test fails, as it should.
  it('falls back to light when localStorage is unavailable', async () => {
    osPrefersDark(true); // dark is reachable ONLY if the throw is not caught
    breakStorage('getItem');

    await loadTheme();

    expect(themes()).toEqual({ theme: 'light', bs: 'light' });
  });

  it('survives a browser with no matchMedia', async () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;

    await loadTheme();

    expect(themes()).toEqual({ theme: 'light', bs: 'light' });
  });
});

describe('themeToggle.js', () => {
  const renderToggle = () => {
    document.body.innerHTML = `<button id="theme-toggle"><span class="theme-toggle__icon"></span></button>`;
  };

  it('flips light to dark, and persists it', async () => {
    html().setAttribute('data-theme', 'light');
    renderToggle();
    await loadToggle();

    toggleBtn().click();

    expect(themes()).toEqual({ theme: 'dark', bs: 'dark' });
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('flips dark back to light', async () => {
    html().setAttribute('data-theme', 'dark');
    renderToggle();
    await loadToggle();

    toggleBtn().click();

    expect(themes()).toEqual({ theme: 'light', bs: 'light' });
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('reflects the current theme on the button at load', async () => {
    html().setAttribute('data-theme', 'dark');
    renderToggle();

    await loadToggle();

    expect(toggleBtn().getAttribute('aria-pressed')).toBe('true');
    expect(toggleBtn().getAttribute('aria-label')).toBe('Switch to light theme');
    expect(icon().textContent).toBe('☀');
  });

  it('updates the icon and a11y state on click', async () => {
    html().setAttribute('data-theme', 'light');
    renderToggle();
    await loadToggle();
    expect(toggleBtn().getAttribute('aria-pressed')).toBe('false');
    expect(icon().textContent).toBe('☾');

    toggleBtn().click();

    expect(toggleBtn().getAttribute('aria-pressed')).toBe('true');
    expect(toggleBtn().getAttribute('aria-label')).toBe('Switch to light theme');
    expect(icon().textContent).toBe('☀');
  });

  it('still applies the theme when the choice cannot be persisted', async () => {
    html().setAttribute('data-theme', 'light');
    renderToggle();
    await loadToggle();
    breakStorage('setItem');

    toggleBtn().click();

    expect(themes()).toEqual({ theme: 'dark', bs: 'dark' });
    expect(
      (window as unknown as { Logger: { warn: ReturnType<typeof vi.fn> } }).Logger.warn,
    ).toHaveBeenCalled();
  });

  it('does nothing on a page with no toggle', async () => {
    document.body.innerHTML = '';

    await expect(loadToggle()).resolves.not.toThrow();
  });
});
