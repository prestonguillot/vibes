/**
 * Enables/disables the refresh button based on Spotify connection status.
 *
 * The "own playlists only" filter is fully declarative now: the checkbox carries
 * name="ownOnly" value="true", and the toggle / refresh button / list container
 * send it via the element's own value or hx-include - no JS URL rewriting needed.
 */

document.addEventListener('DOMContentLoaded', function() {
  const refreshBtn = document.getElementById('refresh-playlists-btn');

  /**
   * Check if Spotify is connected (that's all we need to refresh the playlist list)
   */
  function checkConnectionStatus() {
    const spotifyStatus = document.querySelector('#spotify-status [data-service="spotify"]');

    const spotifyConnected = spotifyStatus?.dataset.connected === 'true';

    if (refreshBtn) {
      if (spotifyConnected) {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('disabled');
        refreshBtn.title = 'Refresh playlist list from Spotify';
      } else {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('disabled');
        refreshBtn.title = 'Connect to Spotify to refresh playlists';
      }
    }
  }

  // Check connection status on load
  checkConnectionStatus();

  // Re-check whenever the status areas are updated via HTMX
  document.body.addEventListener('htmx:afterSwap', function(event) {
    if (event.detail.target.id === 'spotify-status' || event.detail.target.id === 'youtube-status') {
      checkConnectionStatus();
    }
  });
});
