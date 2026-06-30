/**
 * Visual-regression baselines for the CSS-sensitive components. Renders the real
 * EJS partials with fixtures + the actual stylesheets and screenshots each in
 * isolation - no dev server, no auth, no reliance on the debug showcase.
 *
 * Run: `npm run test:visual` (compare) / `npm run test:visual:update` (rebaseline).
 * Local-only by design (see playwright.config.ts).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';

const ROOT = path.join(__dirname, '../..');
const CSS = [
  fs.readFileSync(path.join(ROOT, 'public/vendor/bootstrap.min.css'), 'utf-8'),
  fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf-8'),
].join('\n');

// Solid-colour data-URI images so screenshots need no network and stay deterministic.
const img = (color: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%23${color}'/%3E%3C/svg%3E`;

async function pageFor(partial: string, data: Record<string, unknown>): Promise<string> {
  const body = await ejs.renderFile(path.join(ROOT, 'views/partials', partial), data);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
    body { margin: 0; padding: 16px; background: #fff; }
    .harness { max-width: 900px; }</style></head>
    <body><div class="harness">${body}</div></body></html>`;
}

const score = {
  stars: 4.5,
  totalScore: 0.9,
  color: '#3bb54a',
  components: { coreMatch: 0.6, officialVideo: 0.3 },
};
const spotify = (over = {}) => ({
  id: 't1',
  name: 'Song Title',
  artist: 'The Artist',
  album: 'An Album',
  albumArt: img('cc3366'),
  ...over,
});
const youtube = (over = {}) => ({
  id: 'vid1',
  title: 'Song Title (Official Video)',
  url: '#',
  thumbnail: img('3366cc'),
  ...over,
});

const detailsBase = {
  playlistId: 'pl1',
  playlistName: 'My Playlist',
  linkedCount: 1,
  totalTracks: 2,
  needsResync: false,
};

test('playlist-details: spotify-only (album art + text-only rows)', async ({ page }) => {
  await page.setContent(
    await pageFor('playlist-details.ejs', {
      ...detailsBase,
      hasYoutubeConnection: false,
      hasYoutubePlaylist: false,
      tracks: [
        { spotify: spotify(), youtube: null, linked: false },
        {
          spotify: spotify({ id: 't2', name: 'No Art Song', albumArt: '' }),
          youtube: null,
          linked: false,
        },
      ],
    }),
  );
  await expect(page.locator('.harness')).toHaveScreenshot('details-spotify-only.png');
});

test('playlist-details: youtube-connected-but-unsynced (album-art fix case)', async ({ page }) => {
  await page.setContent(
    await pageFor('playlist-details.ejs', {
      ...detailsBase,
      hasYoutubeConnection: true,
      hasYoutubePlaylist: false,
      tracks: [{ spotify: spotify(), youtube: null, linked: false }],
    }),
  );
  await expect(page.locator('.harness')).toHaveScreenshot('details-yt-unsynced.png');
});

test('playlist-details: synced (linked video + unlinked placeholder + drift)', async ({ page }) => {
  await page.setContent(
    await pageFor('playlist-details.ejs', {
      ...detailsBase,
      hasYoutubeConnection: true,
      hasYoutubePlaylist: true,
      needsResync: true,
      tracks: [
        { spotify: spotify(), youtube: youtube(), linked: true, matchScore: score },
        {
          spotify: spotify({ id: 't2', name: 'Unlinked Song', albumArt: '' }),
          youtube: null,
          linked: false,
        },
      ],
    }),
  );
  await expect(page.locator('.harness')).toHaveScreenshot('details-synced.png');
});

for (const [label, type, percentage, details] of [
  ['progress', 'progress', 45, '✓ Linked 45 • ⚠ Unlinked 5'],
  ['complete', 'complete', 100, null],
  ['error', 'error', null, null],
] as const) {
  test(`progress-update: ${label}`, async ({ page }) => {
    await page.setContent(
      await pageFor('progress-update.ejs', {
        type,
        message: `State: ${label}`,
        percentage,
        details,
      }),
    );
    await expect(page.locator('.harness')).toHaveScreenshot(`progress-${label}.png`);
  });
}

test('error-message', async ({ page }) => {
  await page.setContent(
    await pageFor('error-message.ejs', {
      type: 'warning',
      title: 'YouTube Quota Exceeded',
      message: 'Your quota has been exceeded.',
      details: 'Resets at midnight Pacific.',
    }),
  );
  await expect(page.locator('.harness')).toHaveScreenshot('error-message.png');
});

const playlistItem = (over = {}) => ({
  id: 'p1',
  name: 'My Playlist',
  tracksTotal: 33,
  youtubeTracksTotal: 30,
  spotifyUrl: '#',
  youtubeUrl: '#',
  isSynced: true,
  syncIcon: '',
  buttonText: 'Update YouTube Playlist',
  buttonClass: 'btn-outline-success',
  isYouTubeConnected: true,
  isDisabled: false,
  ...over,
});

test('playlist-item: synced', async ({ page }) => {
  await page.setContent(await pageFor('playlist-item.ejs', playlistItem()));
  await expect(page.locator('.harness')).toHaveScreenshot('playlist-item-synced.png');
});

test('playlist-item: unsynced', async ({ page }) => {
  await page.setContent(
    await pageFor(
      'playlist-item.ejs',
      playlistItem({
        id: 'p2',
        name: 'Unsynced Playlist',
        tracksTotal: null,
        youtubeTracksTotal: 0,
        youtubeUrl: undefined,
        isSynced: false,
        buttonText: 'Sync to YouTube',
        buttonClass: 'btn-primary',
      }),
    ),
  );
  await expect(page.locator('.harness')).toHaveScreenshot('playlist-item-unsynced.png');
});

test('video-selection-modal', async ({ page }) => {
  const body = await ejs.renderFile(path.join(ROOT, 'views/partials/video-selection-modal.ejs'), {
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
        description: 'Official music video. '.repeat(12),
        thumbnail: img('3366cc'),
        matchScore: score,
      },
      {
        id: 'v2',
        title: 'Song Title (Live)',
        channelTitle: 'A Fan',
        description: 'Live performance from a concert.',
        thumbnail: img('cc9933'),
        matchScore: {
          stars: 3,
          totalScore: 0.62,
          color: '#e0a800',
          components: { coreMatch: 0.6 },
        },
      },
    ],
  });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
    body{margin:0;padding:16px;background:#fff}.harness{max-width:640px}</style></head>
    <body><div class="harness"><div class="modal-content">${body}</div></div></body></html>`);
  await expect(page.locator('.harness')).toHaveScreenshot('video-selection-modal.png');
});
