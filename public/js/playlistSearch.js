/**
 * Client-side search over the playlist list.
 *
 * Filters the already-rendered playlist rows by playlist name and by track/video
 * names (Spotify track names are lazy-loaded on the first keystroke so you can also
 * search by song). Debounced while typing.
 *
 * Matching is a deliberately simple, case-insensitive, word-by-word substring test.
 * It used to do Levenshtein fuzzy scoring, which duplicated the server's track
 * matching for no real benefit on a short, already-on-screen list.
 */

// Lazy-loaded map of playlistId -> [track names], populated on first search.
let playlistSpotifyTracks = null;
let spotifyTracksLoading = false;

// Matches when every whitespace-separated query word appears as a substring of the
// text. Order-independent and case-insensitive (e.g. "weeknd blinding" matches
// "Blinding Lights - The Weeknd").
function matchesQuery(text, query) {
  if (!query) return true;
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

// Get all searchable text from a playlist item
function getPlaylistSearchText(playlistItem) {
  const searchParts = [];

  // Get playlist name from the title
  const titleElement = playlistItem.querySelector('.playlist-title, h5');
  if (titleElement) {
    searchParts.push(titleElement.textContent);
  }

  // Get Spotify track names from lazy-loaded cache
  if (playlistSpotifyTracks) {
    const playlistId = playlistItem.dataset.playlistId;
    const spotifyTracks = playlistSpotifyTracks[playlistId];
    if (spotifyTracks && Array.isArray(spotifyTracks)) {
      searchParts.push(spotifyTracks.join(' '));
    }
  }

  // Get all track names from the playlist details (if expanded)
  const trackElements = playlistItem.querySelectorAll('.track-name, .track-item');
  trackElements.forEach((trackEl) => {
    const trackText = trackEl.textContent;
    if (trackText) {
      searchParts.push(trackText);
    }
  });

  // Get all video titles (if available)
  const videoElements = playlistItem.querySelectorAll('.video-title, [data-video-title]');
  videoElements.forEach((videoEl) => {
    const videoText = videoEl.textContent || videoEl.dataset.videoTitle;
    if (videoText) {
      searchParts.push(videoText);
    }
  });

  return searchParts.join(' ');
}

document.addEventListener('DOMContentLoaded', function () {
  const searchInput = document.getElementById('playlistSearch');
  let searchTimeout;

  if (!searchInput) return;

  // Lazy-load Spotify tracks for all playlists
  async function loadSpotifyTracks() {
    // Only load once
    if (playlistSpotifyTracks || spotifyTracksLoading) {
      return;
    }

    spotifyTracksLoading = true;
    const playlistsContainer = document.getElementById('playlists-content');
    if (!playlistsContainer) {
      spotifyTracksLoading = false;
      return;
    }

    // Only select the main playlist item containers, not other elements with data-playlist-id
    const playlistItems = playlistsContainer.querySelectorAll('.playlist-item');
    const playlistIds = Array.from(playlistItems).map((item) => item.dataset.playlistId);

    if (playlistIds.length === 0) {
      spotifyTracksLoading = false;
      return;
    }

    try {
      // Show loading indicator
      const loadingIndicator = document.createElement('div');
      loadingIndicator.id = 'playlist-tracks-loading';
      loadingIndicator.className = 'alert alert-info mt-2';
      loadingIndicator.textContent = 'Loading track data for search...';
      playlistsContainer.parentElement.insertBefore(loadingIndicator, playlistsContainer);

      // Fetch all playlist tracks in parallel
      const response = await fetch(`/api/playlistTracks?playlistIds=${playlistIds.join(',')}`);
      if (!response.ok) {
        throw new Error('Failed to fetch playlist tracks');
      }

      playlistSpotifyTracks = await response.json();

      // Remove loading indicator
      const indicator = document.getElementById('playlist-tracks-loading');
      if (indicator) {
        indicator.remove();
      }
    } catch (error) {
      Logger.error('Error loading Spotify tracks', {}, error);
      spotifyTracksLoading = false;
      // Continue with search anyway, just without Spotify track data
    }

    spotifyTracksLoading = false;
  }

  // Debounced search function
  function performSearch() {
    const query = searchInput.value.trim();
    const playlistsContainer = document.getElementById('playlists-content');

    if (!playlistsContainer) return;

    const playlistItems = playlistsContainer.querySelectorAll('[data-playlist-id]');

    let visibleCount = 0;

    playlistItems.forEach((item) => {
      const searchText = getPlaylistSearchText(item);
      const matches = matchesQuery(searchText, query);

      if (matches) {
        item.classList.remove('search-hidden');
        visibleCount++;
      } else {
        item.classList.add('search-hidden');
      }
    });

    // Show/hide "no results" message if needed
    if (visibleCount === 0 && query) {
      let noResultsMessage = playlistsContainer.querySelector('.no-search-results');
      if (!noResultsMessage) {
        noResultsMessage = document.createElement('div');
        noResultsMessage.className = 'no-search-results alert alert-info mt-3';
        playlistsContainer.appendChild(noResultsMessage);
      }
      noResultsMessage.textContent = `No playlists found matching "${query}"`;
      noResultsMessage.classList.remove('hidden');
    } else {
      const noResultsMessage = playlistsContainer.querySelector('.no-search-results');
      if (noResultsMessage) {
        noResultsMessage.classList.add('hidden');
      }
    }
  }

  // Listen for input events with debounce
  searchInput.addEventListener('keyup', function () {
    clearTimeout(searchTimeout);

    // On first keystroke, load Spotify tracks if not already loaded
    const query = searchInput.value.trim();
    if (query && !playlistSpotifyTracks && !spotifyTracksLoading) {
      loadSpotifyTracks().then(() => {
        // After tracks are loaded, perform search
        searchTimeout = setTimeout(performSearch, 300);
      });
    } else {
      // Normal debounced search
      searchTimeout = setTimeout(performSearch, 300); // 300ms delay
    }
  });

  // Clear search on Escape key
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      searchInput.value = '';
      clearTimeout(searchTimeout);
      performSearch();
    }
  });

  // Re-run search when playlists are reloaded via HTMX
  document.body.addEventListener('htmx:afterSwap', function (event) {
    if (event.detail.target.id === 'playlists-content') {
      // Clear cached Spotify tracks so they'll be re-fetched on next search
      playlistSpotifyTracks = null;

      // Remove search-hidden class from all items (reset to visible)
      const playlistItems = event.detail.target.querySelectorAll('[data-playlist-id]');
      playlistItems.forEach((item) => {
        item.classList.remove('search-hidden');
      });

      // Re-run search if there's a query active
      if (searchInput.value.trim()) {
        clearTimeout(searchTimeout);
        // If we have an active search, re-trigger the load
        if (!playlistSpotifyTracks && !spotifyTracksLoading) {
          loadSpotifyTracks().then(() => {
            searchTimeout = setTimeout(performSearch, 100);
          });
        } else {
          searchTimeout = setTimeout(performSearch, 100);
        }
      }
    }
  });
});
