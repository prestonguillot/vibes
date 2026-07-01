// Runs in <head> BEFORE first paint to avoid a flash of the wrong theme. Sets [data-theme] on
// <html> from the saved choice, falling back to the OS setting (prefers-color-scheme) - this is
// where "toggle defaults to system" is realised. themeToggle.js later updates it on click.
// Kept tiny and dependency-free (runs before logger.js and everything else).
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = saved || (prefersDark ? 'dark' : 'light');
    // data-theme drives our tokens; data-bs-theme drives Bootstrap 5.3's own component dark
    // mode (alert backgrounds, the btn-close X, form controls, dropdowns).
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-bs-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-bs-theme', 'light');
  }
})();
