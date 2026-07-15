/**
 * public/js/*.js are classic browser scripts: IIFEs served via <script src>, which attach their
 * API to `window`. They are not ES modules and must not become ones - `export {}` would break the
 * plain script tags that load them.
 *
 * Tests still import them for their side effects, because v8 attributes coverage to a FILE and
 * eval'd code has no file to attribute it to: eval'ing these leaves them invisible to the coverage
 * report no matter how well they are tested. These declarations let tsc accept the side-effect
 * import without allowJs (which would parse the IIFE and reject it as "not a module").
 */
declare module '*/public/js/youtubeCache.js';
declare module '*/public/js/videoModal.js';
declare module '*/public/js/playlistMeta.js';
declare module '*/public/js/playlistScroll.js';
declare module '*/public/js/playlistSearch.js';
declare module '*/public/js/youtubeConnectionRefresh.js';
declare module '*/public/js/playlistFilter.js';
declare module '*/public/js/sync.js';
declare module '*/public/js/themeToggle.js';
declare module '*/public/js/dismissAlert.js';
declare module '*/public/js/theme.js';
declare module '*/public/js/indexPage.js';
