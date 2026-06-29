/**
 * Client-side cache of the Spotify-playlist -> YouTube-playlist ID mapping.
 *
 * The server is authoritative and can always resolve this mapping itself; this
 * cache just lets a playlist-details request tell the server the YouTube
 * playlist ID it already knows, so the server can skip listing all of the user's
 * YouTube playlists (and a Spotify name lookup) to rediscover it. The mapping is
 * sent up as the X-YT-Playlist-Id request header and refreshed from the
 * X-YT-Playlist-Id response header the server returns.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'yt-playlist-ids';
  var DETAILS_PATH = /\/api\/playlistDetails\/playlist\/([^/?]+)/;

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
      // Storage unavailable/full: the server still resolves everything itself.
    }
  }

  function getCachedId(spotifyPlaylistId) {
    return loadMap()[spotifyPlaylistId];
  }

  function setCachedId(spotifyPlaylistId, youtubePlaylistId) {
    var map = loadMap();
    if (youtubePlaylistId) {
      map[spotifyPlaylistId] = youtubePlaylistId;
    } else {
      delete map[spotifyPlaylistId];
    }
    saveMap(map);
  }

  function detailsPlaylistId(path) {
    var match = (path || '').match(DETAILS_PATH);
    return match ? match[1] : null;
  }

  // Attach the cached YouTube playlist id to outgoing details requests.
  document.body.addEventListener('htmx:configRequest', function (evt) {
    var spotifyId = detailsPlaylistId(evt.detail.path);
    if (!spotifyId) return;
    var cachedId = getCachedId(spotifyId);
    if (cachedId) {
      evt.detail.headers['X-YT-Playlist-Id'] = cachedId;
    }
  });

  // Persist the YouTube playlist id the server resolved (empty string clears it).
  document.body.addEventListener('htmx:afterRequest', function (evt) {
    var xhr = evt.detail.xhr;
    var config = evt.detail.requestConfig;
    if (!xhr || !config) return;
    var spotifyId = detailsPlaylistId(config.path);
    if (!spotifyId) return;
    var resolved = xhr.getResponseHeader('X-YT-Playlist-Id');
    if (resolved === null) return; // header not present: leave cache as-is
    setCachedId(spotifyId, resolved || null);
  });

  // Exposed for tests.
  window.youtubeCache = { getCachedId: getCachedId, setCachedId: setCachedId };
})();
