/**
 * Playlist Details Module
 * Handles playlist expansion/collapse functionality and detail caching
 */

// Playlist details storage functions
function savePlaylistDetailsToStorage(playlistId, detailsHtml) {
    try {
        const storageKey = `playlist_details_${playlistId}`;
        localStorage.setItem(storageKey, detailsHtml);
        localStorage.setItem(`${storageKey}_timestamp`, Date.now().toString());
        console.log(`Playlist details saved for: ${playlistId}`);
    } catch (error) {
        console.warn('Failed to save playlist details to localStorage:', error);
    }
}

function loadPlaylistDetailsFromStorage(playlistId) {
    try {
        const storageKey = `playlist_details_${playlistId}`;
        const timestamp = localStorage.getItem(`${storageKey}_timestamp`);
        const detailsHtml = localStorage.getItem(storageKey);

        if (timestamp && detailsHtml) {
            const ageMs = Date.now() - parseInt(timestamp);
            const ageMinutes = ageMs / (1000 * 60);

            // Cache expires after 10 minutes (shorter than main playlist cache)
            if (ageMinutes < 10) {
                console.log(`Loading cached playlist details for ${playlistId} (${Math.round(ageMinutes)} minutes old)`);
                return detailsHtml;
            } else {
                console.log(`Cached playlist details expired for ${playlistId}`);
                clearPlaylistDetailsStorage(playlistId);
            }
        }
    } catch (error) {
        console.warn('Failed to load playlist details from localStorage:', error);
    }
    return null;
}

function clearPlaylistDetailsStorage(playlistId) {
    try {
        const storageKey = `playlist_details_${playlistId}`;
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`${storageKey}_timestamp`);
        console.log(`Cleared playlist details cache for: ${playlistId}`);
    } catch (error) {
        console.warn('Failed to clear playlist details cache:', error);
    }
}

// Global function for toggling playlist details
function togglePlaylistDetails(playlistId, expandArea) {
    console.log(`Toggle clicked for playlist: ${playlistId}, current expanded: ${expandArea.dataset.expanded}`);
    const detailsContainer = document.getElementById(`details-${playlistId}`);
    const isExpanded = expandArea.dataset.expanded === 'true';
    const indicator = expandArea.querySelector('.expand-indicator');

    if (isExpanded) {
        console.log(`Collapsing playlist details: ${playlistId}`);
        detailsContainer.style.display = 'none';
        indicator.textContent = '▼';
        indicator.style.color = '#666';
        expandArea.dataset.expanded = 'false';
        expandArea.title = 'Show track details';
        console.log(`Collapsed playlist details: ${playlistId}`);
    } else {
        console.log(`Expanding playlist details: ${playlistId}`);
        const cachedDetails = loadPlaylistDetailsFromStorage(playlistId);

        if (cachedDetails) {
            // Use cached data
            detailsContainer.innerHTML = cachedDetails;
            detailsContainer.style.display = 'block';
            indicator.textContent = '▲';
            indicator.style.color = '#ff0040';
            expandArea.dataset.expanded = 'true';
            expandArea.title = 'Hide track details';
            console.log(`Expanded with cached data: ${playlistId}`);
        } else {
            // Load from API
            console.log(`Loading playlist details from API: ${playlistId}`);
            detailsContainer.style.display = 'block';
            indicator.textContent = '...';
            indicator.style.color = '#999';
            expandArea.style.pointerEvents = 'none';
            expandArea.style.display = 'none';

            // Use HTMX to fetch details
            htmx.ajax('GET', `/api/playlistDetails/playlist/${playlistId}`, {
                target: `#details-${playlistId}`,
                swap: 'innerHTML'
            }).then(() => {
                // Success - update indicator
                indicator.textContent = '▲';
                indicator.style.color = '#ff0040';
                expandArea.dataset.expanded = 'true';
                expandArea.style.pointerEvents = 'auto';
                expandArea.style.display = 'flex';
                expandArea.title = 'Hide track details';

                // Save to cache
                const detailsHtml = detailsContainer.innerHTML;
                savePlaylistDetailsToStorage(playlistId, detailsHtml);

                console.log(`Loaded and cached playlist details: ${playlistId}`);
            }).catch((error) => {
                // Error - reset indicator
                console.error('Error loading playlist details:', error);
                indicator.textContent = '▼';
                indicator.style.color = '#666';
                expandArea.dataset.expanded = 'false';
                expandArea.style.pointerEvents = 'auto';
                expandArea.style.display = 'flex';
                expandArea.title = 'Show track details';
                detailsContainer.style.display = 'none';
            });
        }
    }
}

// Function to refresh playlist details
function refreshPlaylistDetails(playlistId) {
    console.log(`Refreshing playlist details for: ${playlistId}`);
    
    // Clear cached details first
    clearPlaylistDetailsStorage(playlistId);
    
    // Use HTMX to fetch fresh details
    htmx.ajax('GET', `/api/playlistDetails/playlist/${playlistId}`, {
        target: `#details-${playlistId}`,
        swap: 'innerHTML'
    }).then(() => {
        console.log(`Refreshed playlist details for: ${playlistId}`);
        
        // Save fresh details to cache
        const detailsContainer = document.getElementById(`details-${playlistId}`);
        if (detailsContainer) {
            savePlaylistDetailsToStorage(playlistId, detailsContainer.innerHTML);
        }
    }).catch((error) => {
        console.error('Error refreshing playlist details:', error);
    });
}

// Make functions available globally
window.savePlaylistDetailsToStorage = savePlaylistDetailsToStorage;
window.loadPlaylistDetailsFromStorage = loadPlaylistDetailsFromStorage;
window.clearPlaylistDetailsStorage = clearPlaylistDetailsStorage;
window.togglePlaylistDetails = togglePlaylistDetails;
window.refreshPlaylistDetails = refreshPlaylistDetails;
