/**
 * YouTube Connection Refresh Handler
 * Refreshes playlists when YouTube connects, bypassing cache
 * Preserves expand/collapse checkbox states during refresh
 */

(function () {
  'use strict';

  // The status endpoint emits `youtubeConnected` on EVERY poll while connected (every 5m),
  // not just on the connect transition - the server is stateless and can't tell the two
  // apart. Refetching the whole Spotify library on each heartbeat hammers Spotify into a
  // 429, so refresh only on the first signal per page load (a genuine connect goes through
  // an OAuth redirect, which reloads the page and re-arms this).
  let refreshedForConnection = false;

  // Listen for the youtubeConnected event from the status endpoint
  document.body.addEventListener('youtubeConnected', function () {
    if (refreshedForConnection) return;

    const playlistsContent = document.getElementById('playlists-content');

    if (playlistsContent && window.htmx) {
      refreshedForConnection = true;

      // Save checkbox states before refresh
      const checkboxStates = new Map();
      document.querySelectorAll('.playlist-expand-toggle').forEach((checkbox) => {
        checkboxStates.set(checkbox.id, checkbox.checked);
      });

      // Get current ownOnly state
      const ownOnlyCheckbox = document.getElementById('ownPlaylistsOnly');
      const ownOnly = ownOnlyCheckbox ? ownOnlyCheckbox.checked : true;

      // htmx.ajax's context takes target/swap/headers/values/select/selectOOB/source/event/handler
      // - there is no `onload`, and unknown keys are ignored silently. It returns a promise that
      // settles once the swap is done, so the restore work hangs off that.
      window.htmx
        .ajax('GET', `/auth/spotify/playlists?ownOnly=${ownOnly}`, {
          target: '#playlists-content',
          swap: 'innerHTML',
          headers: {
            'Cache-Control': 'no-cache',
          },
        })
        .then(() => {
          // Suppress transitions to prevent blinking when restoring checkbox states
          playlistsContent.classList.add('no-transition');

          checkboxStates.forEach((isChecked, checkboxId) => {
            const checkbox = document.getElementById(checkboxId);
            if (checkbox && isChecked) {
              checkbox.checked = true;
            }
          });

          // Force reflow to apply changes immediately, then re-enable transitions
          // eslint-disable-next-line no-unused-expressions
          playlistsContent.offsetHeight;
          playlistsContent.classList.remove('no-transition');

          // The list was re-rendered, so any expanded playlist is showing pre-connect details.
          document.querySelectorAll('.playlist-expand-toggle:checked').forEach((checkbox) => {
            const playlistId = checkbox.id.replace('expand-', '');
            if (document.getElementById(`details-${playlistId}`)) {
              window.htmx.ajax('GET', `/api/playlistDetails/playlist/${playlistId}`, {
                target: `#details-${playlistId}`,
                swap: 'innerHTML',
              });
            }
          });
        })
        .catch((error) => {
          Logger.error('Failed to refresh playlists after YouTube connected', {}, error);
        });
    }
  });
})();
