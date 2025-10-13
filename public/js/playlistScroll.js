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

    console.log('Collapse area clicked:', collapseArea);

    const playlistId = collapseArea.dataset.playlistId;
    if (!playlistId) {
      console.log('No playlist ID found on collapse area');
      return;
    }

    console.log('Playlist ID:', playlistId);

    // Get the checkbox that controls the expand/collapse state
    const checkbox = document.getElementById('expand-' + playlistId);
    console.log('Checkbox:', checkbox, 'Checked:', checkbox ? checkbox.checked : 'N/A');

    if (!checkbox || !checkbox.checked) {
      console.log('Checkbox not checked or not found, aborting');
      return; // Already collapsed or checkbox not found
    }

    // Calculate the target scroll position BEFORE the collapse happens
    // We want the bottom of the collapsed playlist (the expand button area) to end up at the top third of the viewport

    // Find the expand button - this is what will be at the bottom of the collapsed playlist
    const expandButton = document.querySelector('label.playlist-expand-area[data-playlist-id="' + playlistId + '"]');
    if (!expandButton) {
      console.log('Expand button not found');
      return;
    }

    const expandButtonRect = expandButton.getBoundingClientRect();
    const expandButtonBottom = window.pageYOffset + expandButtonRect.bottom;

    console.log('Expand button bottom position:', expandButtonBottom);

    const viewportHeight = window.innerHeight;
    const targetScrollPosition = expandButtonBottom - (viewportHeight / 3);

    // Check if we have enough room to scroll to that position
    const maxScroll = document.documentElement.scrollHeight - viewportHeight;
    const finalScrollPosition = Math.max(0, Math.min(targetScrollPosition, maxScroll));

    // Only scroll if we actually need to move (avoid unnecessary scrolling)
    const currentScroll = window.pageYOffset;

    console.log('Scroll calculation:', {
      expandButtonBottom,
      viewportHeight,
      targetScrollPosition,
      maxScroll,
      finalScrollPosition,
      currentScroll,
      difference: Math.abs(currentScroll - finalScrollPosition)
    });

    if (Math.abs(currentScroll - finalScrollPosition) < 10) {
      console.log('Already close enough to target position, skipping scroll');
      return; // Already close enough to target position
    }

    console.log('Scrolling to:', finalScrollPosition);

    // Smooth scroll to the calculated position after a brief delay to let the collapse animation start
    setTimeout(function() {
      window.scrollTo({
        top: finalScrollPosition,
        behavior: 'smooth'
      });
      console.log('Scroll command executed');
    }, 100);
  });
})();
