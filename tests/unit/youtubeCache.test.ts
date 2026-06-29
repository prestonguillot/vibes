/**
 * @vitest-environment happy-dom
 *
 * Tests for the client-side Spotify->YouTube playlist-id cache (public/js/youtubeCache.js):
 * it injects a cached id as the X-YT-Playlist-Id request header and stores the
 * authoritative id the server returns.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '../../public/js/youtubeCache.js'),
  'utf-8'
);

function loadModule() {
  // Execute the IIFE against the happy-dom globals (document, localStorage, window).
  // eslint-disable-next-line no-eval
  (0, eval)(source);
}

const detailsPath = (spotifyId: string) => `/api/playlistDetails/playlist/${spotifyId}`;

describe('youtubeCache.js', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    loadModule();
  });

  it('stores and reads a cached id', () => {
    window.youtubeCache.setCachedId('sp1', 'yt1');
    expect(window.youtubeCache.getCachedId('sp1')).toBe('yt1');
  });

  it('clears a cached id when set to null', () => {
    window.youtubeCache.setCachedId('sp1', 'yt1');
    window.youtubeCache.setCachedId('sp1', null);
    expect(window.youtubeCache.getCachedId('sp1')).toBeUndefined();
  });

  it('injects the cached id as X-YT-Playlist-Id on a details request', () => {
    window.youtubeCache.setCachedId('sp1', 'yt1');
    const detail = { path: detailsPath('sp1'), headers: {} as Record<string, string> };
    document.body.dispatchEvent(new CustomEvent('htmx:configRequest', { detail }));
    expect(detail.headers['X-YT-Playlist-Id']).toBe('yt1');
  });

  it('does not inject a header when nothing is cached', () => {
    const detail = { path: detailsPath('sp-unknown'), headers: {} as Record<string, string> };
    document.body.dispatchEvent(new CustomEvent('htmx:configRequest', { detail }));
    expect(detail.headers['X-YT-Playlist-Id']).toBeUndefined();
  });

  it('does not inject a header on non-details requests', () => {
    window.youtubeCache.setCachedId('sp1', 'yt1');
    const detail = { path: '/auth/spotify/playlists', headers: {} as Record<string, string> };
    document.body.dispatchEvent(new CustomEvent('htmx:configRequest', { detail }));
    expect(detail.headers['X-YT-Playlist-Id']).toBeUndefined();
  });

  it('stores the id the server returns in X-YT-Playlist-Id', () => {
    const detail = {
      xhr: { getResponseHeader: (h: string) => (h === 'X-YT-Playlist-Id' ? 'yt-from-server' : null) },
      requestConfig: { path: detailsPath('sp2') }
    };
    document.body.dispatchEvent(new CustomEvent('htmx:afterRequest', { detail }));
    expect(window.youtubeCache.getCachedId('sp2')).toBe('yt-from-server');
  });

  it('clears the cached id when the server returns an empty X-YT-Playlist-Id', () => {
    window.youtubeCache.setCachedId('sp3', 'stale');
    const detail = {
      xhr: { getResponseHeader: (h: string) => (h === 'X-YT-Playlist-Id' ? '' : null) },
      requestConfig: { path: detailsPath('sp3') }
    };
    document.body.dispatchEvent(new CustomEvent('htmx:afterRequest', { detail }));
    expect(window.youtubeCache.getCachedId('sp3')).toBeUndefined();
  });

  it('leaves the cache untouched when the response has no X-YT-Playlist-Id header', () => {
    window.youtubeCache.setCachedId('sp4', 'keep');
    const detail = {
      xhr: { getResponseHeader: () => null },
      requestConfig: { path: detailsPath('sp4') }
    };
    document.body.dispatchEvent(new CustomEvent('htmx:afterRequest', { detail }));
    expect(window.youtubeCache.getCachedId('sp4')).toBe('keep');
  });
});
