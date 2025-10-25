/**
 * Fuzzy search for playlists
 * Filters playlist items based on playlist name and track/video names
 * Uses debounce to avoid excessive filtering while user is typing
 */

// Levenshtein distance algorithm for fuzzy matching
function levenshteinDistance(str1, str2) {
  const lower1 = str1.toLowerCase();
  const lower2 = str2.toLowerCase();
  const matrix = [];

  for (let i = 0; i <= lower2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lower1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= lower2.length; i++) {
    for (let j = 1; j <= lower1.length; j++) {
      if (lower2.charAt(i - 1) === lower1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[lower2.length][lower1.length];
}

// Calculate similarity score (0-1, where 1 is exact match)
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;

  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  return Math.max(0, 1 - (distance / maxLength));
}

// Check if query matches text with fuzzy matching
function fuzzyMatch(text, query) {
  if (!query) return true;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Exact substring match (highest priority)
  if (lowerText.includes(lowerQuery)) return true;

  // Word-based matching (allow missing common words like "of")
  const textWords = lowerText.split(/\s+/);
  const queryWords = lowerQuery.split(/\s+/);

  // Check if all query words are present as substrings in the text
  return queryWords.every(qWord =>
    textWords.some(tWord => {
      const similarity = calculateSimilarity(tWord, qWord);
      // Allow matches with >70% similarity for typo tolerance
      return similarity > 0.7 || tWord.includes(qWord);
    })
  );
}

// Get all searchable text from a playlist item
function getPlaylistSearchText(playlistItem) {
  const searchParts = [];

  // Get playlist name from the title
  const titleElement = playlistItem.querySelector('.playlist-title, h5');
  if (titleElement) {
    searchParts.push(titleElement.textContent);
  }

  // Get all track names from the playlist details
  const trackElements = playlistItem.querySelectorAll('.track-name, .track-item');
  trackElements.forEach(trackEl => {
    const trackText = trackEl.textContent;
    if (trackText) {
      searchParts.push(trackText);
    }
  });

  // Get all video titles (if available)
  const videoElements = playlistItem.querySelectorAll('.video-title, [data-video-title]');
  videoElements.forEach(videoEl => {
    const videoText = videoEl.textContent || videoEl.dataset.videoTitle;
    if (videoText) {
      searchParts.push(videoText);
    }
  });

  return searchParts.join(' ');
}

document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('playlistSearch');
  let searchTimeout;

  if (!searchInput) return;

  // Debounced search function
  function performSearch() {
    const query = searchInput.value.trim();
    const playlistsContainer = document.getElementById('playlists-content');

    if (!playlistsContainer) return;

    const playlistItems = playlistsContainer.querySelectorAll('[data-playlist-id]');

    let visibleCount = 0;

    playlistItems.forEach(item => {
      const searchText = getPlaylistSearchText(item);
      const matches = fuzzyMatch(searchText, query);

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
        noResultsMessage.textContent = `No playlists found matching "${query}"`;
        playlistsContainer.appendChild(noResultsMessage);
      }
      noResultsMessage.style.display = 'block';
    } else {
      const noResultsMessage = playlistsContainer.querySelector('.no-search-results');
      if (noResultsMessage) {
        noResultsMessage.style.display = 'none';
      }
    }
  }

  // Listen for input events with debounce
  searchInput.addEventListener('keyup', function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300); // 300ms delay
  });

  // Clear search on Escape key
  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      searchInput.value = '';
      clearTimeout(searchTimeout);
      performSearch();
    }
  });

  // Re-run search when playlists are reloaded via HTMX
  document.body.addEventListener('htmx:afterSwap', function(event) {
    if (event.detail.target.id === 'playlists-content') {
      // Remove search-hidden class from all items (reset to visible)
      const playlistItems = event.detail.target.querySelectorAll('[data-playlist-id]');
      playlistItems.forEach(item => {
        item.classList.remove('search-hidden');
      });

      // Re-run search if there's a query active
      if (searchInput.value.trim()) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(performSearch, 100);
      }
    }
  });
});
