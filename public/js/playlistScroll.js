/**
 * Playlist Collapse Scroll Handler
 * Smoothly scrolls the playlist to the top third of the viewport when collapsing from the bottom
 */

(function() {
  'use strict';

  // Listen for clicks on collapse areas
  document.addEventListener('click', function(event) {
    const collapseArea = event.target.closest('.playlist-collapse-area');

    if (!collapseArea) {
      return;
    }

    const playlistId = collapseArea.dataset.playlistId;
    if (!playlistId) {
      return;
    }

    // Get the checkbox that controls the expand/collapse state
    const checkbox = document.getElementById('expand-' + playlistId);
    if (!checkbox || !checkbox.checked) {
      return; // Already collapsed or checkbox not found
    }

    // Get the playlist item container
    const playlistItem = document.querySelector('.playlist-item[data-playlist-id="' + playlistId + '"]');
    if (!playlistItem) {
      return;
    }

    // Calculate the scroll position to place the bottom of the playlist at the top third of the viewport
    const viewportHeight = window.innerHeight;
    const targetScrollPosition = playlistItem.offsetTop + playlistItem.offsetHeight - (viewportHeight / 3);

    // Check if we have enough room to scroll to that position
    const maxScroll = document.documentElement.scrollHeight - viewportHeight;
    const finalScrollPosition = Math.max(0, Math.min(targetScrollPosition, maxScroll));

    // Smooth scroll to the calculated position after a short delay to allow the collapse animation to start
    setTimeout(function() {
      window.scrollTo({
        top: finalScrollPosition,
        behavior: 'smooth'
      });
    }, 50);
  });
})();
