/**
 * Client-side cache of per-playlist metadata (Spotify track count + drift state),
 * used to decorate the collapsed playlist list.
 *
 * The list endpoint can't cheaply know each playlist's exact Spotify track count
 * (Spotify's /me/playlists no longer returns it) or whether it's out of sync
 * (that needs the full per-playlist comparison the details view performs). So when
 * a playlist's details load - when the row is opened, on a manual refresh, or in a
 * sync's last frame - we cache the count and the needsResync flag it computed, keyed
 * by Spotify playlist id, and use it to fill "X of Y" and an out-of-sync dot onto the
 * collapsed row.
 *
 * Opening the row is the only thing that loads details unprompted: the container carries an
 * `intersect` trigger, but it is display:none until then and a hidden element never intersects.
 *
 * The server remains authoritative: this is a "last known" decoration that the
 * next details load refreshes. Nothing here triggers extra API calls.
 *
 * Which of the two is right depends on which is newer, and neither always is. The counts in the
 * page were fetched by the server moments ago, so on a fresh load they beat anything cached from a
 * previous visit. After a sync, the page's copy is the stale one and the cache holds what the sync
 * just did. Cached entries are stamped so the two can be told apart: reading the cache first
 * regardless is what left a freshly synced playlist's row reading "140 of 141" with the drift dot
 * lit, under a details view already reading 141 of 141.
 *
 * The drift dot has no server-side counterpart at all - working it out means the full per-playlist
 * comparison the details view does - so it stays last-known either way.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'playlist-meta';

  // This runs while the page the server just rendered is parsing, so anything stamped before now
  // was cached on an earlier visit.
  var PAGE_RENDERED_AT = Date.now();

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
    map[id] = {
      trackCount: meta.trackCount,
      linkedCount: meta.linkedCount,
      needsResync: meta.needsResync,
      updatedAt: Date.now(),
    };
    saveMap(map);
  }

  /** A number the server rendered onto the row, or null where it had none to give. */
  function serverNumber(row, attribute) {
    var raw = row.getAttribute(attribute);
    if (raw === null || raw === '') return null;
    var value = parseInt(raw, 10);
    return isNaN(value) ? null : value;
  }

  // Rebuild a collapsed row's track summary and out-of-sync dot from cached meta.
  function decorateRow(row) {
    var id = row.getAttribute('data-playlist-id');
    if (!id) return;
    var meta = getMeta(id);
    if (!meta) return;

    // Entries cached before this page was rendered lost to it; entries written since - by a sync,
    // or by opening the row - are what the page does not know yet. An entry from before stamping
    // existed is, by definition, from an earlier visit.
    //
    // Written-in-the-same-millisecond counts as newer: an earlier visit cannot share a millisecond
    // with this one, and a details view that loads the instant the page does otherwise loses to the
    // page it just corrected.
    var cacheIsNewer = typeof meta.updatedAt === 'number' && meta.updatedAt >= PAGE_RENDERED_AT;

    var serverLinked = serverNumber(row, 'data-youtube-count');
    var serverTracks = serverNumber(row, 'data-track-count');

    var linkedCount =
      cacheIsNewer && typeof meta.linkedCount === 'number'
        ? meta.linkedCount
        : serverLinked !== null
          ? serverLinked
          : meta.linkedCount;

    // Spotify omits the total in Dev Mode, so the cache is the only place it exists at all - use
    // it whenever the server had none, however old it is.
    var trackCount =
      cacheIsNewer && typeof meta.trackCount === 'number'
        ? meta.trackCount
        : serverTracks !== null
          ? serverTracks
          : meta.trackCount;

    var summary = row.querySelector('.playlist-track-summary');
    if (summary && typeof trackCount === 'number') {
      summary.textContent =
        linkedCount > 0
          ? linkedCount + ' of ' + trackCount + ' tracks synced to YouTube'
          : trackCount + ' tracks';
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
      var linked = parseInt(el.getAttribute('data-linked-count'), 10);
      setMeta(id, {
        trackCount: isNaN(count) ? null : count,
        linkedCount: isNaN(linked) ? null : linked,
        needsResync: el.getAttribute('data-needs-resync') === 'true',
      });
    }
  }

  // After any swap: capture details that just loaded, then re-decorate the list.
  //
  // Both events, and the whole document rather than what was swapped. A sync delivers the
  // playlist's refreshed details out-of-band, into #details-<id>: htmx announces that with
  // oobAfterSwap, and the afterSwap it does fire names the status box, which does not contain
  // them. Reading only inside the swapped element left the row saying "140 of 141" with the drift
  // dot lit while the flyout below it already read 141 of 141.
  function captureAndDecorate() {
    syncFromDetails(document);
    decorateAll();
  }
  document.body.addEventListener('htmx:afterSwap', captureAndDecorate);
  document.body.addEventListener('htmx:oobAfterSwap', captureAndDecorate);

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
