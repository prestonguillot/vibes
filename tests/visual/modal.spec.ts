/**
 * Behaviour tests for the native-<dialog> video-selection modal: it opens when the
 * content is swapped in (htmx:afterSwap), closes on a [data-dialog-close] control,
 * on Escape, and the radio->confirm wiring still enables the confirm button.
 *
 * Runs under `npm run test:visual` (Playwright). Loads the real videoModal.js +
 * the real partial; no dev server.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';

const ROOT = path.join(__dirname, '../..');
const CSS = [
  fs.readFileSync(path.join(ROOT, 'public/vendor/bootstrap.min.css'), 'utf-8'),
  fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf-8')
].join('\n');
const VIDEO_MODAL_JS = fs.readFileSync(path.join(ROOT, 'public/js/videoModal.js'), 'utf-8');
const img = (c: string) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%23${c}'/%3E%3C/svg%3E`;
const score = { stars: 4.5, totalScore: 0.9, color: '#3bb54a', components: { coreMatch: 0.6 } };

async function modalPage(): Promise<string> {
  const content = await ejs.renderFile(path.join(ROOT, 'views/partials/video-selection-modal.ejs'), {
    modalTitle: 'Choose a video', instructionText: 'Pick the best match', currentVideoId: '', playlistId: 'p1', trackId: 't1',
    videos: [
      { id: 'v1', title: 'Song (Official Video)', channelTitle: 'The Artist', description: 'desc '.repeat(8), thumbnail: img('3366cc'), matchScore: score },
      { id: 'v2', title: 'Song (Live)', channelTitle: 'A Fan', description: 'live', thumbnail: img('cc9933'), matchScore: { stars: 3, totalScore: 0.6, color: '#e0a800', components: {} } }
    ]
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    <dialog id="videoSelectionModal" class="video-modal"><div class="modal-content"><div id="video-modal-content">${content}</div></div></dialog>
    <script>window.Logger = { error() {}, debug() {} };</script>
    <script>${VIDEO_MODAL_JS}</script>
  </body></html>`;
}

const isOpen = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (document.getElementById('videoSelectionModal') as HTMLDialogElement).open);

// Fire the htmx:afterSwap the real handler listens for, to open the dialog + wire radios.
const swapIn = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.dispatchEvent(new CustomEvent('htmx:afterSwap', {
    detail: { target: document.getElementById('video-modal-content') }
  })));

test('opens on afterSwap and closes on a close control', async ({ page }) => {
  await page.setContent(await modalPage());
  expect(await isOpen(page)).toBe(false);
  await swapIn(page);
  expect(await isOpen(page)).toBe(true);
  await page.locator('.btn-close[data-dialog-close]').click();
  expect(await isOpen(page)).toBe(false);
});

test('Escape closes the dialog', async ({ page }) => {
  await page.setContent(await modalPage());
  await swapIn(page);
  expect(await isOpen(page)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await isOpen(page)).toBe(false);
});

test('selecting a video enables the confirm button (wiring intact)', async ({ page }) => {
  await page.setContent(await modalPage());
  await swapIn(page);
  const confirm = page.locator('#confirm-selection-btn');
  await expect(confirm).toBeDisabled();
  await page.locator('label[for="video-v1"]').click();
  await expect(confirm).toBeEnabled();
});

// Screenshot the OPEN dialog in its real nesting (dialog > .modal-content >
// #video-modal-content). This is the layout the user actually sees - the earlier
// component baseline screenshotted .modal-content in isolation and never open, so
// it missed the close-button-position bug. This guards the header layout.
test('open dialog layout', async ({ page }) => {
  await page.setContent(await modalPage());
  await swapIn(page);
  await expect(page.locator('#videoSelectionModal')).toHaveScreenshot('modal-open.png');
});
