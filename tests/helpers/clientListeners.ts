import { vi } from 'vitest';

/**
 * Record the listeners a client script binds while it loads, so a test can unbind them afterwards.
 *
 * public/js modules attach to `document` / `document.body` at import time. Those nodes outlive
 * `document.body.innerHTML = ''` and `vi.resetModules()`, so without this every test would stack
 * another copy of the module's handlers on top of the previous one's - and the copies interfere:
 * in videoModal, a second beforeRequest handler recorded the FIRST one's spinner markup as the
 * button's "original" label.
 *
 * Usage: start it, import the module, stop() it, and removeAll() in afterEach.
 */
export function trackListeners(...targets: EventTarget[]) {
  const added: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];

  const spies = targets.map((target) => {
    const original = target.addEventListener.bind(target);
    return vi
      .spyOn(target, 'addEventListener')
      .mockImplementation(
        (
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: boolean | AddEventListenerOptions,
        ) => {
          if (listener) added.push([target, type, listener]);
          original(type, listener, options);
        },
      );
  });

  return {
    /** Stop intercepting; the module has finished binding. */
    stop: () => spies.forEach((spy) => spy.mockRestore()),
    /** Unbind everything the module bound. */
    removeAll: () => {
      added.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
      added.length = 0;
    },
  };
}
