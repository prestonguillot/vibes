/**
 * Argos visual-testing prototype. Renders representative views the same way the local snapshot
 * suite does (real EJS partials + the actual stylesheets), but captures with `argosScreenshot`
 * instead of `toHaveScreenshot` - so the baseline lives in Argos, not as a committed PNG.
 *
 * `argosScreenshot` also stabilises the page before capturing (waits for fonts/images, hides
 * carets, freezes CSS animations), which removes most of the env-specific noise that makes
 * raw pixel baselines flaky across machines.
 *
 * Run via `npm run test:visual:argos` (config: playwright.argos.config.ts).
 */
import { test } from '@playwright/test';
import { argosScreenshot } from '@argos-ci/playwright';
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';

const ROOT = path.join(__dirname, '../..');
const CSS = [
  fs.readFileSync(path.join(ROOT, 'public/vendor/bootstrap.min.css'), 'utf-8'),
  fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf-8'),
].join('\n');

const img = (c: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%23${c}'/%3E%3C/svg%3E`;

const page = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;

test('video selection modal', async ({ page: p }) => {
  const content = await ejs.renderFile(
    path.join(ROOT, 'views/partials/video-selection-modal.ejs'),
    {
      modalTitle: 'Choose a video',
      instructionText: 'Pick the best match for <strong>Song Title</strong>',
      currentVideoId: '',
      playlistId: 'p1',
      trackId: 't1',
      videos: [
        {
          id: 'v1',
          title: 'Song Title (Official Video)',
          channelTitle: 'The Artist',
          description: 'Official music video. '.repeat(10),
          thumbnail: img('3366cc'),
          matchScore: {
            stars: 4.5,
            totalScore: 0.9,
            color: '#3bb54a',
            components: { coreMatch: 0.6 },
          },
        },
        {
          id: 'v2',
          title: 'Song Title (Live)',
          channelTitle: 'A Fan',
          description: 'Live performance from a concert.',
          thumbnail: img('cc9933'),
          matchScore: { stars: 3, totalScore: 0.62, color: '#e0a800', components: {} },
        },
      ],
    },
  );
  await p.setContent(
    page(
      `<dialog id="m" class="video-modal"><div class="modal-content"><div id="video-modal-content">${content}</div></div></dialog>`,
    ),
  );
  await p.evaluate(() => (document.getElementById('m') as HTMLDialogElement).showModal());
  await argosScreenshot(p, 'video-selection-modal');
});

test('connection error modal', async ({ page: p }) => {
  await p.setContent(
    page(`
      <dialog class="connection-error-modal" id="m" aria-labelledby="l">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="l">Spotify Connection Failed</h5>
            <button type="button" class="btn-close" data-dialog-close aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="modal-message">Spotify API quota exceeded. Please wait and try again later.</p>
            <div class="text-center"><button type="button" class="btn btn-error-modal" data-dialog-close>OK</button></div>
          </div>
        </div>
      </dialog>`),
  );
  await p.evaluate(() => (document.getElementById('m') as HTMLDialogElement).showModal());
  await argosScreenshot(p, 'connection-error-modal');
});

test('playlist details - synced', async ({ page: p }) => {
  const body = await ejs.renderFile(path.join(ROOT, 'views/partials/playlist-details.ejs'), {
    playlistId: 'demo',
    playlistName: 'Workout Mix',
    totalTracks: 2,
    linkedCount: 2,
    hasYoutubeConnection: true,
    hasYoutubePlaylist: true,
    needsResync: false,
    tracks: [
      {
        spotify: { name: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', id: 'sp1' },
        youtube: {
          title: 'The Weeknd - Blinding Lights',
          url: '#',
          thumbnail: img('ff0000'),
          id: 'yt1',
        },
        linked: true,
      },
      {
        spotify: { name: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', id: 'sp2' },
        youtube: { title: 'Dua Lipa - Levitating', url: '#', thumbnail: img('00aa55'), id: 'yt2' },
        linked: true,
      },
    ],
  });
  await p.setContent(page(`<div class="harness">${body}</div>`));
  await argosScreenshot(p, 'playlist-details-synced');
});
