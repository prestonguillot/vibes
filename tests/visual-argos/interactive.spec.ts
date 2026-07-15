/**
 * Coverage the retired committed-PNG suite never had: interactive :hover states (driven with a
 * real pointer move) and a full-page composition (the component showcase, styled the way the
 * app serves it). These are exactly the states the CSS !important audit had to force by hand -
 * captured here so a regression in them shows up as an Argos diff.
 */
import { test } from '@playwright/test';
import { argosScreenshot } from '@argos-ci/playwright';
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import {
  setTheme,
  renderPartial,
  renderHtml,
  renderString,
  videoModalFixture,
  playlistItem,
  ROOT,
} from './helpers';

test.beforeEach(({}, testInfo) => setTheme((testInfo.project.metadata.theme as string) ?? 'light'));

test('video option hovered', async ({ page }) => {
  const body = await renderString('video-selection-modal.ejs', videoModalFixture);
  await renderHtml(
    page,
    `<dialog id="m" class="video-modal"><div class="modal-content"><div id="video-modal-content">${body}</div></div></dialog>`,
  );
  await page.evaluate(() => (document.getElementById('m') as HTMLDialogElement).showModal());
  await page.locator('.video-option').first().hover();
  await argosScreenshot(page, 'video-option-hovered');
});

test('sync button hovered', async ({ page }) => {
  await renderPartial(page, 'playlist-item.ejs', playlistItem());
  await page.locator('.playlist-item button').first().hover();
  await argosScreenshot(page, 'playlist-item-button-hovered');
});

test('component showcase (full-page composition)', async ({ page }) => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/debug-fixtures.json'), 'utf-8'));
  const html: string = await ejs.renderFile(
    path.join(ROOT, 'views/debug-components.ejs'),
    fixtures,
  );
  // The showcase is a full document whose <head> links a stylesheet no server is serving here;
  // extract its <body> and re-wrap so the real CSS from helpers applies.
  const bodyInner = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  await renderHtml(page, bodyInner, '.harness{max-width:1000px}');
  await argosScreenshot(page, 'component-showcase');
});
