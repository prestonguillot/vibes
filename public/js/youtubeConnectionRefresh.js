/**
 * YouTube Connection Refresh Handler
 * Refreshes playlists when YouTube connects, bypassing cache
 */

(function() {
  'use strict';

  // Listen for the youtubeConnected event from the status endpoint
  document.body.addEventListener('youtubeConnected', function() {
    const playlistsContent = document.getElementById('playlists-content');

    if (playlistsContent && window.htmx) {
      // Get current ownOnly state
      const ownOnlyCheckbox = document.getElementById('ownPlaylistsOnly');
      const ownOnly = ownOnlyCheckbox ? ownOnlyCheckbox.checked : true;

      // Trigger HTMX request with cache-busting header
      window.htmx.ajax('GET', `/auth/spotify/playlists?ownOnly=${ownOnly}`, {
        target: '#playlists-content',
        swap: 'innerHTML',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
    }
  });
})();
