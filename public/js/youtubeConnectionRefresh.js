/**
 * YouTube Connection Refresh Handler
 * Refreshes playlists when YouTube connects, bypassing cache
 * Preserves expand/collapse checkbox states during refresh
 */

(function() {
  'use strict';

  // Listen for the youtubeConnected event from the status endpoint
  document.body.addEventListener('youtubeConnected', function() {
    const playlistsContent = document.getElementById('playlists-content');

    if (playlistsContent && window.htmx) {
      // Save checkbox states before refresh
      const checkboxStates = new Map();
      document.querySelectorAll('.playlist-expand-toggle').forEach(checkbox => {
        checkboxStates.set(checkbox.id, checkbox.checked);
      });

      // Get current ownOnly state
      const ownOnlyCheckbox = document.getElementById('ownPlaylistsOnly');
      const ownOnly = ownOnlyCheckbox ? ownOnlyCheckbox.checked : true;

      // Trigger HTMX request with cache-busting header
      window.htmx.ajax('GET', `/auth/spotify/playlists?ownOnly=${ownOnly}`, {
        target: '#playlists-content',
        swap: 'innerHTML',
        headers: {
          'Cache-Control': 'no-cache'
        },
        // Restore checkbox states after swap completes (without animation flashing)
        onload: function() {
          // Disable transitions to prevent blinking when restoring checkbox states
          playlistsContent.style.transition = 'none';

          checkboxStates.forEach((isChecked, checkboxId) => {
            const checkbox = document.getElementById(checkboxId);
            if (checkbox && isChecked) {
              checkbox.checked = true;
            }
          });

          // Force reflow to apply changes immediately, then re-enable transitions
          // eslint-disable-next-line no-unused-expressions
          playlistsContent.offsetHeight;
          playlistsContent.style.transition = '';

          // Reload details for any expanded playlists to get fresh data
          // The details container might have old cached content, so we need to refresh
          if (window.htmx) {
            document.querySelectorAll('.playlist-expand-toggle:checked').forEach(checkbox => {
              const playlistId = checkbox.id.replace('expand-', '');
              const detailsContainer = document.getElementById(`details-${playlistId}`);
              if (detailsContainer) {
                // Trigger HTMX to reload the details
                window.htmx.ajax('GET', `/api/playlistDetails/playlist/${playlistId}`, {
                  target: `#details-${playlistId}`,
                  swap: 'innerHTML'
                });
              }
            });
          }
        }
      });
    }
  });
})();
