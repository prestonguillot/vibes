/**
 * Integration tests for /debug/components.
 *
 * The showcase's whole value is being trustworthy: it is the only surface that renders the real
 * components with no Spotify, so it is where design review happens. Every check here exists
 * because the page was, at one point, quietly lying about one of them.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';
import fixtures from '@/debug-fixtures.json';

const app = testServer(createApp());
const root = path.join(__dirname, '../..');

describe('GET /debug/components', () => {
  it('renders', async () => {
    await request(app).get('/debug/components').expect(200);
  });

  it('shows every sync-button state the fixtures describe', async () => {
    // It used to loop over ids that did not exist ('demo-1'..'demo-3'), label each with the FIRST
    // playlist, and hardcode one btn-primary "Sync to YouTube" - three identical buttons under a
    // heading promising different states.
    const { text } = await request(app).get('/debug/components');

    const states = [...new Set(fixtures.mockPlaylists.map((p) => p.buttonText))];
    expect(states.length).toBeGreaterThan(1);
    states.forEach((label) => expect(text).toContain(label));
  });

  it('labels each sync button with its own playlist', async () => {
    const { text } = await request(app).get('/debug/components');

    fixtures.mockPlaylists.forEach((p) => expect(text).toContain(p.name));
  });

  it('carries a theme toggle, wired to the real script', async () => {
    // Half the page's job is judging components in BOTH themes. Without a toggle it could only
    // show whichever theme the OS happened to prefer.
    const { text } = await request(app).get('/debug/components');

    expect(text).toContain('id="theme-toggle"');
    expect(text).toContain('/js/themeToggle.js');
  });

  it('shows the Spotify-only view, where the bleed carries the row alone', async () => {
    // The linked view puts a video preview over the same space, so this is the ONLY place the
    // album-art treatment can actually be judged. It was missing entirely.
    const { text } = await request(app).get('/debug/components');

    expect(text).toContain('youtube-video__thumbnail--album');
    expect(text).toContain('track-item--art-fill');
  });

  it('renders the press, or every picture on the page is a lie', async () => {
    const { text } = await request(app).get('/debug/components');

    expect(text).toContain('id="print-photo"');
    expect(text).toContain('id="print-bleed"');
  });
});

describe('debug fixtures', () => {
  it('points at no external image host', () => {
    // They pointed at via.placeholder.com until it stopped resolving, and the page rendered broken
    // images for who knows how long.
    const raw = JSON.stringify(fixtures);
    const external = raw.match(/"(https?:\/\/[^"]+\.(png|jpe?g|svg|gif|webp)[^"]*)"/g) ?? [];

    expect(external).toEqual([]);
  });

  it('ships every image it references', () => {
    const raw = JSON.stringify(fixtures);
    const local = [...new Set(raw.match(/\/images\/[a-z0-9/-]+\.svg/g) ?? [])];

    expect(local.length).toBeGreaterThan(0);
    local.forEach((p) => {
      expect(fs.existsSync(path.join(root, 'public', p)), `${p} is referenced but missing`).toBe(
        true,
      );
    });
  });

  it('gives every playlist a cover and every track its art', () => {
    // With neither, the showcase renders no cover, no tape, and no bleed - i.e. none of the work
    // it exists to show. It carried neither for the entire time the styling was built.
    fixtures.mockPlaylists.forEach((p) => expect(p.coverImage).toBeTruthy());
    fixtures.mockPlaylistDetails.tracks.forEach((t) => {
      if (t.spotify) expect(t.spotify.albumArt).toBeTruthy();
    });
  });
});

describe('the showcase covers the controls it is asked about', () => {
  it('shows the search field, so the hand-cut magnifier can be reviewed', async () => {
    // The icon only existed on the real page, which needs Spotify. It could not be looked at here
    // at all - the one surface that exists for looking at things.
    const { text } = await request(app).get('/debug/components');

    expect(text).toContain('search-icon');
    expect(text).toContain('search-input');
  });
});
