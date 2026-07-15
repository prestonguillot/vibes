/**
 * After YouTube connects, re-render the playlist list so it shows sync state.
 *
 * The list is cacheable, so the copy the browser holds was very likely fetched before the connect
 * and shows every playlist as unsynced. This refetch bypasses that cache.
 *
 * It runs only when the OAuth callback says a connect just happened (?connected=youtube). The
 * status endpoint cannot be the signal: it holds no session, so it cannot tell "connected" from
 * "just connected", and refetching on every render costs a fresh listing of every playlist on both
 * services for a connection that has not changed.
 *
 * Expand/collapse state is preserved across the swap, and any open playlist's details are refetched
 * because the ones on screen were rendered without YouTube.
 */

(function () {
  'use strict';

  const CONNECTED_PARAM = 'connected';

  function refreshPlaylists() {
    const playlistsContent = document.getElementById('playlists-content');
    if (!playlistsContent || !window.htmx) return;

    const checkboxStates = new Map();
    document.querySelectorAll('.playlist-expand-toggle').forEach((checkbox) => {
      checkboxStates.set(checkbox.id, checkbox.checked);
    });

    const ownOnlyCheckbox = document.getElementById('ownPlaylistsOnly');
    const ownOnly = ownOnlyCheckbox ? ownOnlyCheckbox.checked : true;

    // htmx.ajax's context takes target/swap/headers/values/select/selectOOB/source/event/handler -
    // there is no `onload`, and unknown keys are ignored silently. It returns a promise that settles
    // once the swap is done, so the restore work hangs off that.
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

  function handleConnectSignal() {
    const params = new URLSearchParams(window.location.search);
    if (params.get(CONNECTED_PARAM) !== 'youtube') return;

    // Drop the marker before refetching, so reloading the page is an ordinary load rather than
    // another forced refresh.
    params.delete(CONNECTED_PARAM);
    const query = params.toString();
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + (query ? `?${query}` : ''),
    );

    refreshPlaylists();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleConnectSignal);
  } else {
    handleConnectSignal();
  }
})();
