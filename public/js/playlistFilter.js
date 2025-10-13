/**
 * Playlist filter toggle handler
 * Updates the hx-get URL based on checkbox state
 * Also manages refresh button state based on connection status
 */

document.addEventListener('DOMContentLoaded', function() {
  const toggle = document.getElementById('ownPlaylistsOnly');
  const refreshBtn = document.getElementById('refresh-playlists-btn');

  /**
   * Check if both Spotify and YouTube are connected
   */
  function checkConnectionStatus() {
    const spotifyStatus = document.querySelector('#spotify-status [data-service="spotify"]');
    const youtubeStatus = document.querySelector('#youtube-status [data-service="youtube"]');

    const spotifyConnected = spotifyStatus?.dataset.connected === 'true';
    const youtubeConnected = youtubeStatus?.dataset.connected === 'true';
    const bothConnected = spotifyConnected && youtubeConnected;

    if (refreshBtn) {
      if (bothConnected) {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('disabled');
      } else {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('disabled');
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

  if (toggle && refreshBtn) {
    // Listen for htmx:configRequest on the toggle to modify the request URL
    toggle.addEventListener('htmx:configRequest', function(event) {
      // Read the current checkbox state
      const isChecked = this.checked;
      const ownOnlyValue = isChecked ? 'true' : 'false';

      // Modify the request path to include the correct parameter
      event.detail.path = `/auth/spotify/playlists?ownOnly=${ownOnlyValue}`;
    });

    // Listen for htmx:configRequest on the refresh button to use the current toggle state
    refreshBtn.addEventListener('htmx:configRequest', function(event) {
      // Read the current toggle state
      const isChecked = toggle.checked;
      const ownOnlyValue = isChecked ? 'true' : 'false';

      // Modify the request path to include the correct parameter
      event.detail.path = `/auth/spotify/playlists?ownOnly=${ownOnlyValue}`;
    });
  }
});
