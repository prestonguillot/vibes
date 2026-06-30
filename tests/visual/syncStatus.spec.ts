/**
 * sync.js reacts to the SSE stream's terminal `htmx:sseClose` frame: on success it
 * flips the status box to success and moves the playlist into the synced section; on
 * error it flips to error and leaves the playlist put; element-removal closes
 * (nodeReplaced/nodeMissing) are ignored. Driven with synthetic events - no live SSE.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const SYNC_JS = fs.readFileSync(path.join(ROOT, 'public/js/sync.js'), 'utf-8');

// Two playlists out of alphabetical order, the synced one (Apple) carrying a status box.
function pageFor(finalContent: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div id="playlists-content">
      <div class="playlist-item" data-playlist-id="zebra"><h5>Zebra</h5></div>
      <div class="playlist-item" data-playlist-id="apple"><h5>Apple</h5>
        <div id="sync-status-apple" class="sync-status-box sync-status-working">
          <div class="sync-status-content">${finalContent}</div>
          <button type="button" class="sync-status-close" aria-label="Close"></button>
        </div>
      </div>
    </div>
    <script>${SYNC_JS}</script>
  </body></html>`;
}

const fireSseClose = (page: import('@playwright/test').Page, type: string) =>
  page.evaluate((t) => {
    const box = document.getElementById('sync-status-apple')!;
    box.dispatchEvent(new CustomEvent('htmx:sseClose', { bubbles: true, detail: { type: t } }));
  }, type);

const order = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('#playlists-content .playlist-item')).map(
      (el) => (el as HTMLElement).dataset.playlistId,
    ),
  );

test('success close: flips to success and moves the playlist into alphabetical place', async ({
  page,
}) => {
  await page.setContent(pageFor('<div data-sync-success="true">Synced!</div>'));
  expect(await order(page)).toEqual(['zebra', 'apple']);
  await fireSseClose(page, 'message');
  const box = page.locator('#sync-status-apple');
  await expect(box).toHaveClass(/sync-status-success/);
  await expect(box).not.toHaveClass(/sync-status-working/);
  expect(await order(page)).toEqual(['apple', 'zebra']); // moved before Zebra
});

test('error close: flips to error and leaves the playlist where it is', async ({ page }) => {
  await page.setContent(pageFor('<strong>Sync failed</strong>')); // no [data-sync-success]
  await fireSseClose(page, 'message');
  const box = page.locator('#sync-status-apple');
  await expect(box).toHaveClass(/sync-status-error/);
  expect(await order(page)).toEqual(['zebra', 'apple']); // not moved
});

test('element-removal close (nodeReplaced) is ignored', async ({ page }) => {
  await page.setContent(pageFor('<div data-sync-success="true">Synced!</div>'));
  await fireSseClose(page, 'nodeReplaced');
  await expect(page.locator('#sync-status-apple')).toHaveClass(/sync-status-working/);
  expect(await order(page)).toEqual(['zebra', 'apple']);
});

test('the close control dismisses the status box', async ({ page }) => {
  await page.setContent(pageFor('<div>...</div>'));
  await page.locator('.sync-status-close').click();
  await expect(page.locator('#sync-status-apple')).toHaveClass(/hidden/);
});
