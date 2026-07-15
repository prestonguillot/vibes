/**
 * @vitest-environment happy-dom
 *
 * Tests for public/js/eventLogging.js: button clicks, the htmx request lifecycle, and uncaught
 * JavaScript errors.
 *
 * Despite the name it is not purely observational - the htmx:responseError handler swaps a server
 * error partial into the target, which is how a failed request shows the user what went wrong.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackListeners } from '@tests/helpers/clientListeners';

let listeners: ReturnType<typeof trackListeners>;
let logger: {
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  htmx: ReturnType<typeof vi.fn>;
  userAction: ReturnType<typeof vi.fn>;
};

async function load() {
  listeners = trackListeners(document, window);
  vi.resetModules();
  await import('../../public/js/eventLogging.js');
  listeners.stop();
}

/** An htmx lifecycle event, as htmx dispatches it on document. */
const htmxEvent = (name: string, detail: Record<string, unknown>) =>
  document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));

const xhr = (over: Record<string, unknown> = {}) => ({
  status: 200,
  statusText: 'OK',
  responseURL: 'https://app/api/thing',
  responseText: 'ok',
  getResponseHeader: () => 'text/html',
  ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  logger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    htmx: vi.fn(),
    userAction: vi.fn(),
  };
  (window as unknown as { Logger: typeof logger }).Logger = logger;
});

afterEach(() => listeners?.removeAll());

describe('button clicks', () => {
  it('records the button text as a user action', async () => {
    document.body.innerHTML = '<button id="sync">  Sync Now  </button>';
    await load();

    document.getElementById('sync')!.click();

    expect(logger.userAction).toHaveBeenCalledWith('Button clicked', { text: 'Sync Now' });
  });

  it('records the button attributes for debugging', async () => {
    document.body.innerHTML = '<button id="sync" class="btn punk" type="submit"></button>';
    await load();

    document.getElementById('sync')!.click();

    expect(logger.debug).toHaveBeenCalledWith('Button attributes', {
      id: 'sync',
      class: 'btn punk',
      type: 'submit',
      disabled: false,
    });
  });

  it('ignores clicks that are not on a button', async () => {
    document.body.innerHTML = '<div id="notabutton"></div>';
    await load();

    document.getElementById('notabutton')!.click();

    expect(logger.userAction).not.toHaveBeenCalled();
  });

  it('survives a button with no text', async () => {
    document.body.innerHTML = '<button id="empty"></button>';
    await load();

    expect(() => document.getElementById('empty')!.click()).not.toThrow();
  });
});

describe('the htmx request lifecycle', () => {
  it('records a request starting, with its verb, path and target', async () => {
    document.body.innerHTML = '<div id="playlists-content"></div>';
    await load();

    htmxEvent('htmx:beforeRequest', {
      requestConfig: { verb: 'get', path: '/api/playlists' },
      target: document.getElementById('playlists-content'),
    });

    expect(logger.htmx).toHaveBeenCalledWith('Request starting', {
      method: 'get',
      url: '/api/playlists',
      target: 'playlists-content',
    });
  });

  it('reports an unknown target rather than throwing', async () => {
    await load();

    htmxEvent('htmx:beforeRequest', {
      requestConfig: { verb: 'get', path: '/api/x' },
      target: undefined,
    });

    expect(logger.htmx).toHaveBeenCalledWith(
      'Request starting',
      expect.objectContaining({ target: 'unknown' }),
    );
  });

  it('records a completed request with its status and size', async () => {
    await load();

    htmxEvent('htmx:afterRequest', { xhr: xhr({ responseText: 'hello' }) });

    expect(logger.htmx).toHaveBeenCalledWith('Request completed', {
      status: '200 OK',
      url: 'https://app/api/thing',
      responseLength: 5,
    });
  });

  // A 4xx/5xx is what you go looking for in the console, so it must not be filed as a debug line.
  it('reports a failing request as an error, with the body', async () => {
    await load();

    htmxEvent('htmx:afterRequest', {
      xhr: xhr({ status: 500, statusText: 'Server Error', responseText: 'it broke' }),
    });

    expect(logger.error).toHaveBeenCalledWith('HTMX request failed', {
      responseText: 'it broke',
    });
  });

  it.each([[400], [401], [503]])('treats %i as a failure', async (status) => {
    await load();

    htmxEvent('htmx:afterRequest', { xhr: xhr({ status }) });

    expect(logger.error).toHaveBeenCalledWith('HTMX request failed', expect.anything());
  });

  it('does not report a successful request as an error', async () => {
    await load();

    htmxEvent('htmx:afterRequest', { xhr: xhr({ status: 204 }) });

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('HTMX request successful');
  });
});

describe('showing a server error partial', () => {
  it('swaps an HTML error response into the target', async () => {
    document.body.innerHTML = '<div id="target">old content</div>';
    await load();
    const target = document.getElementById('target')!;

    htmxEvent('htmx:responseError', {
      xhr: xhr({ status: 500, responseText: '<div class="alert">Quota exceeded</div>' }),
      target,
    });

    expect(target.innerHTML).toBe('<div class="alert">Quota exceeded</div>');
    expect(logger.error).toHaveBeenCalledWith('HTMX response error', expect.anything());
  });

  // A JSON or plain-text body is not something to inject into the page.
  it('leaves the target alone when the response is not HTML', async () => {
    document.body.innerHTML = '<div id="target">old content</div>';
    await load();
    const target = document.getElementById('target')!;

    htmxEvent('htmx:responseError', {
      xhr: xhr({
        status: 500,
        responseText: '{"error":"nope"}',
        getResponseHeader: () => 'application/json',
      }),
      target,
    });

    expect(target.innerHTML).toBe('old content');
  });

  it('leaves the target alone when the response is empty', async () => {
    document.body.innerHTML = '<div id="target">old content</div>';
    await load();
    const target = document.getElementById('target')!;

    htmxEvent('htmx:responseError', { xhr: xhr({ status: 500, responseText: '' }), target });

    expect(target.innerHTML).toBe('old content');
  });

  it('survives a response with no Content-Type', async () => {
    document.body.innerHTML = '<div id="target">old content</div>';
    await load();
    const target = document.getElementById('target')!;

    htmxEvent('htmx:responseError', {
      xhr: xhr({ status: 500, getResponseHeader: () => null }),
      target,
    });

    expect(target.innerHTML).toBe('old content');
  });

  it('survives an error with no target to swap into', async () => {
    await load();

    expect(() =>
      htmxEvent('htmx:responseError', { xhr: xhr({ status: 500 }), target: null }),
    ).not.toThrow();
  });

  it('survives an error with no xhr at all', async () => {
    await load();

    expect(() => htmxEvent('htmx:responseError', { xhr: null })).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith('HTMX response error', expect.anything());
  });

  it('reports a send error, which has no response to show', async () => {
    await load();

    htmxEvent('htmx:sendError', { error: 'network down' });

    expect(logger.error).toHaveBeenCalledWith('HTMX send error', { error: 'network down' });
  });
});

describe('uncaught JavaScript errors', () => {
  it('records where the error came from', async () => {
    await load();

    const error = new Error('kaboom');
    window.dispatchEvent(
      Object.assign(new Event('error'), {
        message: 'kaboom',
        filename: 'app.js',
        lineno: 42,
        colno: 7,
        error,
      }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      'JavaScript error',
      { message: 'kaboom', filename: 'app.js', line: 42, column: 7 },
      error,
    );
  });

  it('records a page navigation', async () => {
    await load();

    window.dispatchEvent(new Event('beforeunload'));

    expect(logger.info).toHaveBeenCalledWith('Page navigation detected');
  });
});
