/**
 * Argos captures for every CSS-sensitive component - migrated from the retired committed-PNG
 * suite (tests/visual/components.spec.ts). Same fixtures, but baselines live in Argos, so
 * nothing binary is in git. Runs under every project (viewport) in playwright.argos.config.ts.
 */
import { test } from '@playwright/test';
import { argosScreenshot } from '@argos-ci/playwright';
import {
  renderPartial,
  renderHtml,
  renderString,
  CONNECTION_MODAL,
  videoModalFixture,
  detailsBase,
  playlistItem,
  spotify,
  youtube,
  score,
} from './helpers';

test('playlist-details: spotify-only', async ({ page }) => {
  await renderPartial(page, 'playlist-details.ejs', {
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
  });
  await argosScreenshot(page, 'details-spotify-only');
});

test('playlist-details: youtube-connected-but-unsynced', async ({ page }) => {
  await renderPartial(page, 'playlist-details.ejs', {
    ...detailsBase,
    hasYoutubeConnection: true,
    hasYoutubePlaylist: false,
    tracks: [{ spotify: spotify(), youtube: null, linked: false }],
  });
  await argosScreenshot(page, 'details-yt-unsynced');
});

test('playlist-details: synced', async ({ page }) => {
  await renderPartial(page, 'playlist-details.ejs', {
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
  });
  await argosScreenshot(page, 'details-synced');
});

for (const [label, type, percentage, details] of [
  ['progress', 'progress', 45, '✓ Linked 45 • ⚠ Unlinked 5'],
  ['complete', 'complete', 100, null],
  ['error', 'error', null, null],
] as const) {
  test(`progress-update: ${label}`, async ({ page }) => {
    await renderPartial(page, 'progress-update.ejs', {
      type,
      message: `State: ${label}`,
      percentage,
      details,
    });
    await argosScreenshot(page, `progress-${label}`);
  });
}

test('error-message', async ({ page }) => {
  await renderPartial(page, 'error-message.ejs', {
    type: 'warning',
    title: 'YouTube Quota Exceeded',
    message: 'Your quota has been exceeded.',
    details: 'Resets at midnight Pacific.',
  });
  await argosScreenshot(page, 'error-message');
});

test('playlist-item: synced', async ({ page }) => {
  await renderPartial(page, 'playlist-item.ejs', playlistItem());
  await argosScreenshot(page, 'playlist-item-synced');
});

test('playlist-item: unsynced', async ({ page }) => {
  await renderPartial(
    page,
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
  );
  await argosScreenshot(page, 'playlist-item-unsynced');
});

test('video selection modal', async ({ page }) => {
  const body = await renderString('video-selection-modal.ejs', videoModalFixture);
  await renderHtml(
    page,
    `<dialog id="m" class="video-modal"><div class="modal-content"><div id="video-modal-content">${body}</div></div></dialog>`,
  );
  await page.evaluate(() => (document.getElementById('m') as HTMLDialogElement).showModal());
  await argosScreenshot(page, 'video-selection-modal');
});

test('connection error modal', async ({ page }) => {
  await renderHtml(page, CONNECTION_MODAL);
  await page.evaluate(() =>
    (document.getElementById('connectionErrorModal') as HTMLDialogElement).showModal(),
  );
  await argosScreenshot(page, 'connection-error-modal');
});
