/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/dismissAlert.js: a [data-alert-dismiss] control removes its closest .alert.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackListeners } from '@tests/helpers/clientListeners';

let listeners: ReturnType<typeof trackListeners>;

async function load() {
  listeners = trackListeners(document, document.body);
  vi.resetModules();
  await import('../../public/js/dismissAlert.js');
  listeners.stop();
}

const alerts = () => document.querySelectorAll('.alert').length;

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => listeners?.removeAll());

describe('dismissAlert.js', () => {
  it('removes the alert containing the dismiss control', async () => {
    document.body.innerHTML = `
      <div class="alert"><button data-alert-dismiss>x</button></div>`;
    await load();

    document.querySelector<HTMLElement>('[data-alert-dismiss]')!.click();

    expect(alerts()).toBe(0);
  });

  it('removes only the alert that was dismissed', async () => {
    document.body.innerHTML = `
      <div class="alert" id="a"><button data-alert-dismiss>x</button></div>
      <div class="alert" id="b"><button data-alert-dismiss>x</button></div>`;
    await load();

    document.querySelector<HTMLElement>('#a [data-alert-dismiss]')!.click();

    expect(alerts()).toBe(1);
    expect(document.getElementById('b')).not.toBeNull();
  });

  // The control is usually an icon inside the button, so the click target is a descendant.
  it('works when the click lands on a child of the control', async () => {
    document.body.innerHTML = `
      <div class="alert"><button data-alert-dismiss><span id="icon">x</span></button></div>`;
    await load();

    document.getElementById('icon')!.click();

    expect(alerts()).toBe(0);
  });

  it('ignores clicks elsewhere', async () => {
    document.body.innerHTML = `
      <div class="alert"><button data-alert-dismiss>x</button></div>
      <button id="other">other</button>`;
    await load();

    document.getElementById('other')!.click();

    expect(alerts()).toBe(1);
  });

  it('does nothing when the control is not inside an alert', async () => {
    document.body.innerHTML = `<button data-alert-dismiss>x</button>`;
    await load();

    expect(() =>
      document.querySelector<HTMLElement>('[data-alert-dismiss]')!.click(),
    ).not.toThrow();
  });
});
