/**
 * Client-side cache of per-playlist metadata (Spotify track count + drift state),
 * used to decorate the collapsed playlist list.
 *
 * The list endpoint can't cheaply know each playlist's exact Spotify track count
 * (Spotify's /me/playlists no longer returns it) or whether it's out of sync
 * (that needs the full per-playlist comparison the details view performs). So when
 * a playlist's details load - which happens automatically on intersect, and again
 * on manual refresh or after a sync - we cache the count and the needsResync flag
 * it computed, keyed by Spotify playlist id, and use it to fill "X of Y" and an
 * out-of-sync dot onto the collapsed row.
 *
 * The server remains authoritative: this is a "last known" decoration that the
 * next details load refreshes. Nothing here triggers extra API calls.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'playlist-meta';

  function loadMap() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveMap(map) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      // Storage unavailable/full: the list just shows the server defaults.
    }
  }

  function getMeta(id) {
    return loadMap()[id] || null;
  }

  function setMeta(id, meta) {
    if (!id) return;
    var map = loadMap();
    map[id] = meta;
    saveMap(map);
  }

  // Rebuild a collapsed row's track summary and out-of-sync dot from cached meta.
  function decorateRow(row) {
    var id = row.getAttribute('data-playlist-id');
    if (!id) return;
    var meta = getMeta(id);
    if (!meta) return;

    var youtubeCount = parseInt(row.getAttribute('data-youtube-count'), 10) || 0;
    var summary = row.querySelector('.playlist-track-summary');
    if (summary && typeof meta.trackCount === 'number') {
      summary.textContent =
        youtubeCount > 0
          ? youtubeCount + ' tracks synced to YouTube of ' + meta.trackCount
          : meta.trackCount + ' tracks';
    }

    var dot = row.querySelector('[data-drift-dot]');
    if (dot) {
      dot.classList.toggle('is-visible', !!meta.needsResync);
    }
  }

  function decorateAll() {
    var rows = document.querySelectorAll('.playlist-item[data-playlist-id]');
    for (var i = 0; i < rows.length; i++) {
      decorateRow(rows[i]);
    }
  }

  // Record count + drift from any playlist-details views inside `scope`.
  function syncFromDetails(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var details = scope.querySelectorAll('.playlist-details[data-playlist-id]');
    for (var i = 0; i < details.length; i++) {
      var el = details[i];
      var id = el.getAttribute('data-playlist-id');
      var count = parseInt(el.getAttribute('data-track-count'), 10);
      setMeta(id, {
        trackCount: isNaN(count) ? null : count,
        needsResync: el.getAttribute('data-needs-resync') === 'true',
      });
    }
  }

  // After any swap: capture details that just loaded, then re-decorate the list.
  document.body.addEventListener('htmx:afterSwap', function (evt) {
    syncFromDetails(evt.target || document);
    decorateAll();
  });

  // On initial load, paint last-known values before details lazy-load.
  document.addEventListener('DOMContentLoaded', decorateAll);

  window.playlistMeta = {
    getMeta: getMeta,
    setMeta: setMeta,
    decorateRow: decorateRow,
    decorateAll: decorateAll,
    syncFromDetails: syncFromDetails,
  };
})();
