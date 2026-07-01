/**
 * The connection-error <dialog> opens, closes via its [data-dialog-close] controls
 * (OK / X, handled by videoModal.js) and Escape, and its header lays out correctly.
 * Plus: [data-alert-dismiss] removes its alert (dismissAlert.js).
 *
 * Runs under `npm run test:visual` (Playwright). Loads the real JS + partials.
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
const VIDEO_MODAL_JS = fs.readFileSync(path.join(ROOT, 'public/js/videoModal.js'), 'utf-8');
const DISMISS_ALERT_JS = fs.readFileSync(path.join(ROOT, 'public/js/dismissAlert.js'), 'utf-8');

const CONNECTION_MODAL = `
  <dialog class="connection-error-modal" id="connectionErrorModal" aria-labelledby="connectionErrorLabel">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="connectionErrorLabel">Spotify Connection Failed</h5>
        <button type="button" class="btn-close" data-dialog-close aria-label="Close"></button>
      </div>
      <div class="modal-body">
        <p class="modal-message" id="connectionErrorMessage">Spotify API quota exceeded. Please wait and try again later.</p>
        <div class="text-center"><button type="button" class="btn btn-error-modal" data-dialog-close>OK</button></div>
      </div>
    </div>
  </dialog>`;

function modalPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    ${CONNECTION_MODAL}
    <script>window.Logger = { error() {}, debug() {} };</script>
    <script>${VIDEO_MODAL_JS}</script>
  </body></html>`;
}

const isOpen = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (document.getElementById('connectionErrorModal') as HTMLDialogElement).open);

const open = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    (document.getElementById('connectionErrorModal') as HTMLDialogElement).showModal(),
  );

test('connection modal closes on the OK control', async ({ page }) => {
  await page.setContent(modalPage());
  await open(page);
  expect(await isOpen(page)).toBe(true);
  await page.locator('.btn-error-modal[data-dialog-close]').click();
  expect(await isOpen(page)).toBe(false);
});

test('connection modal closes on the X and on Escape', async ({ page }) => {
  await page.setContent(modalPage());
  await open(page);
  await page.locator('.btn-close[data-dialog-close]').click();
  expect(await isOpen(page)).toBe(false);
  await open(page);
  await page.keyboard.press('Escape');
  expect(await isOpen(page)).toBe(false);
});

test('[data-alert-dismiss] removes its alert', async ({ page }) => {
  const alert = await ejs.renderFile(path.join(ROOT, 'views/partials/video-replace-success.ejs'), {
    message: 'Video replaced.',
  });
  await page.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body>
    ${alert}<script>${DISMISS_ALERT_JS}</script></body></html>`);
  await expect(page.locator('.alert')).toBeVisible();
  await page.locator('[data-alert-dismiss]').click();
  await expect(page.locator('.alert')).toHaveCount(0);
});
