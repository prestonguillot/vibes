// Wires the header theme toggle: flips [data-theme] on <html>, persists the choice to
// localStorage (client-owned UI preference), and keeps the button's icon + a11y state in sync.
// The initial [data-theme] is set pre-paint by theme.js.
(function () {
  function current() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function updateButton(theme) {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var dark = theme === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    var icon = btn.querySelector('.theme-toggle__icon');
    if (icon) icon.textContent = dark ? '☀' : '☾';
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      Logger.warn('Could not persist theme preference', e);
    }
    updateButton(theme);
  }

  function init() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    updateButton(current());
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      apply(next);
      Logger.info('Theme toggled', { theme: next });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
