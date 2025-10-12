/**
 * Playlist filter toggle handler
 * Updates the hx-get URL based on checkbox state
 */

document.addEventListener('DOMContentLoaded', function() {
  const toggle = document.getElementById('ownPlaylistsOnly');
  const refreshBtn = document.getElementById('refresh-playlists-btn');

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
