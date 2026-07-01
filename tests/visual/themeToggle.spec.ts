/**
 * Behaviour of the theme toggle: theme.js sets [data-theme] pre-paint from the stored choice or
 * the OS setting; themeToggle.js flips it on click, persists to localStorage, and keeps the
 * button icon + aria state in sync. Served from a real http origin so localStorage works
 * (setContent's about:blank has no storage).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const THEME_JS = fs.readFileSync(path.join(ROOT, 'public/js/theme.js'), 'utf-8');
const TOGGLE_JS = fs.readFileSync(path.join(ROOT, 'public/js/themeToggle.js'), 'utf-8');

const html = `<!doctype html><html><head><meta charset="utf-8"><script>${THEME_JS}</script></head>
  <body>
    <button type="button" id="theme-toggle" aria-pressed="false" aria-label="Switch to dark theme">
      <span class="theme-toggle__icon">☾</span>
    </button>
    <script>window.Logger = { info() {}, warn() {} };</script>
    <script>${TOGGLE_JS}</script>
  </body></html>`;

// Serve from an http origin (localStorage requires one).
test.beforeEach(async ({ page }) => {
  await page.route('http://theme.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
});

const theme = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));

test('defaults to light when the OS is light and nothing is stored', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://theme.test/');
  expect(await theme(page)).toBe('light');
});

test('defaults to the OS setting (dark) when nothing is stored', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://theme.test/');
  expect(await theme(page)).toBe('dark');
});

test('toggle flips the theme, persists it, and updates the button', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://theme.test/');
  await page.locator('#theme-toggle').click();

  expect(await theme(page)).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.theme-toggle__icon')).toHaveText('☀');
});

test('stored preference overrides the OS setting on load', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://theme.test/');
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload();
  expect(await theme(page)).toBe('light');
});
