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
        Logger.cache('save', `playlist_details_${playlistId}`);
    } catch (error) {
        Logger.warn('Failed to save playlist details to localStorage', { playlistId }, error);
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
                Logger.cache('load', `playlist_details_${playlistId}`, { ageMinutes: Math.round(ageMinutes) });
                return detailsHtml;
            } else {
                Logger.cache('expired', `playlist_details_${playlistId}`, { ageMinutes: Math.round(ageMinutes) });
                clearPlaylistDetailsStorage(playlistId);
            }
        }
    } catch (error) {
        Logger.warn('Failed to load playlist details from localStorage', { playlistId }, error);
    }
    return null;
}

function clearPlaylistDetailsStorage(playlistId) {
    try {
        const storageKey = `playlist_details_${playlistId}`;
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`${storageKey}_timestamp`);
        Logger.cache('clear', `playlist_details_${playlistId}`);
    } catch (error) {
        Logger.warn('Failed to clear playlist details cache', { playlistId }, error);
    }
}

// Global function for toggling playlist details
function togglePlaylistDetails(playlistId, expandArea) {
    Logger.userAction('Toggle playlist details', { playlistId, expanded: expandArea.dataset.expanded });
    const detailsContainer = document.getElementById(`details-${playlistId}`);
    const isExpanded = expandArea.dataset.expanded === 'true';
    const indicator = expandArea.querySelector('.expand-indicator');

    if (isExpanded) {
        Logger.debug('Collapsing playlist details', { playlistId });
        detailsContainer.style.display = 'none';
        indicator.textContent = '▼';
        indicator.style.color = '#666';
        expandArea.dataset.expanded = 'false';
        expandArea.title = 'Show track details';
        Logger.debug('Collapsed playlist details', { playlistId });
    } else {
        Logger.debug('Expanding playlist details', { playlistId });
        const cachedDetails = loadPlaylistDetailsFromStorage(playlistId);

        if (cachedDetails) {
            // Use cached data
            detailsContainer.innerHTML = cachedDetails;
            detailsContainer.style.display = 'block';
            indicator.textContent = '▲';
            indicator.style.color = '#ff0040';
            expandArea.dataset.expanded = 'true';
            expandArea.title = 'Hide track details';
            Logger.debug('Expanded with cached data', { playlistId });
        } else {
            // Load from API
            Logger.info('Loading playlist details from API', { playlistId });
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

                Logger.info('Loaded and cached playlist details', { playlistId });
            }).catch((error) => {
                // Error - reset indicator
                Logger.error('Error loading playlist details', { playlistId }, error);
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
    Logger.userAction('Refresh playlist details', { playlistId });
    
    // Clear cached details first
    clearPlaylistDetailsStorage(playlistId);
    
    // Use HTMX to fetch fresh details
    htmx.ajax('GET', `/api/playlistDetails/playlist/${playlistId}`, {
        target: `#details-${playlistId}`,
        swap: 'innerHTML'
    }).then(() => {
        Logger.info('Refreshed playlist details', { playlistId });
        
        // Save fresh details to cache
        const detailsContainer = document.getElementById(`details-${playlistId}`);
        if (detailsContainer) {
            savePlaylistDetailsToStorage(playlistId, detailsContainer.innerHTML);
        }
    }).catch((error) => {
        Logger.error('Error refreshing playlist details', { playlistId }, error);
    });
}

// Video selection functionality
let selectedVideoId = null;

function editTrackVideo(playlistId, trackId, trackName, artistName, currentVideoId) {
    Logger.userAction('Open video selection', { trackName, artistName, currentVideoId });
    
    // Store current video ID globally for later use
    window.currentVideoId = currentVideoId;
    
    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'video-selection-overlay';
    modalOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1050;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    // Create modal content container
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 20px;
        max-width: 800px;
        max-height: 80vh;
        overflow-y: auto;
        margin: 20px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    `;
    
    modalContent.innerHTML = `
        <div class="d-flex align-items-center justify-content-center">
            <div class="spinner-border" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <span class="ms-2">Searching for alternative videos...</span>
        </div>
    `;
    
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);
    
    // Load video options
    const searchUrl = `/api/playlistDetails/search/${trackId}?trackName=${encodeURIComponent(trackName)}&artistName=${encodeURIComponent(artistName)}`;
    
    htmx.ajax('GET', searchUrl, {
        target: modalContent,
        swap: 'innerHTML'
    }).then(() => {
        // After the modal content loads, add the current video ID to the modal
        const modal = document.querySelector('.video-selection-modal');
        if (modal) {
            modal.dataset.currentVideoId = currentVideoId;
            Logger.debug('Set modal currentVideoId', { currentVideoId });
        } else {
            Logger.error('Could not find .video-selection-modal element to set currentVideoId');
        }
    }).catch((error) => {
        Logger.error('Error loading video options', { trackId, trackName, artistName }, error);
        modalContent.innerHTML = `
            <div class="alert alert-danger">
                <h6>Error loading video options</h6>
                <p>Unable to search for alternative videos. Please try again.</p>
                <button type="button" class="btn btn-secondary" onclick="cancelVideoSelection()">Close</button>
            </div>
        `;
    });
}

function selectVideo(videoId, element) {
    Logger.userAction('Select video', { videoId });
    
    // Remove selection from all other options
    document.querySelectorAll('.video-option').forEach(option => {
        option.style.backgroundColor = '';
        option.style.borderColor = '';
        option.querySelector('.selection-indicator').style.display = 'none';
    });
    
    // Highlight selected option
    element.style.backgroundColor = '#e8f5e8';
    element.style.borderColor = '#28a745';
    element.querySelector('.selection-indicator').style.display = 'block';
    
    // Store selected video ID and enable confirm button
    selectedVideoId = videoId;
    const confirmBtn = document.getElementById('confirm-selection-btn');
    if (confirmBtn) {
        confirmBtn.disabled = false;
    }
}

function cancelVideoSelection() {
    Logger.userAction('Cancel video selection');
    selectedVideoId = null;
    
    const overlay = document.getElementById('video-selection-overlay');
    if (overlay) {
        overlay.remove();
    }
}

function confirmVideoSelection(trackId) {
    if (!selectedVideoId) {
        Logger.error('No video selected for confirmation');
        return;
    }
    
    // Get the current video ID from the modal data or fallback to global variable
    const modal = document.querySelector('.video-selection-modal');
    const currentVideoId = modal?.dataset.currentVideoId || window.currentVideoId;
    
    Logger.userAction('Confirm video selection', { selectedVideoId, trackId, currentVideoId });
    
    // Show loading state
    const confirmBtn = document.getElementById('confirm-selection-btn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `
            <span class="spinner-border spinner-border-sm me-2" role="status"></span>
            Updating...
        `;
    }
    
    // Make API call to replace the video using fetch instead of HTMX
    fetch(`/api/playlistDetails/replace/${trackId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            newVideoId: selectedVideoId,
            currentVideoId: currentVideoId,
            playlistId: document.querySelector('.playlist-details')?.dataset.playlistId
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            Logger.info('Video replacement successful', data);
            cancelVideoSelection();
            
            // Refresh the playlist details to show the updated video
            const playlistId = document.querySelector('.playlist-details')?.dataset.playlistId;
            if (playlistId) {
                refreshPlaylistDetails(playlistId);
            }
        } else {
            throw new Error(data.message || 'Video replacement failed');
        }
    })
    .catch((error) => {
        Logger.error('Error replacing video', { trackId, selectedVideoId, currentVideoId }, error);
        
        // Show error and restore button
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = 'Confirm Selection';
        }
        
        // Show error message
        const modalContent = document.querySelector('.video-selection-modal');
        if (modalContent) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'alert alert-danger mt-3';
            errorDiv.innerHTML = `
                <strong>Error:</strong> ${error.message || 'Failed to replace video. Please try again.'}
            `;
            modalContent.appendChild(errorDiv);
        }
    });
}

// Make functions available globally
window.savePlaylistDetailsToStorage = savePlaylistDetailsToStorage;
window.loadPlaylistDetailsFromStorage = loadPlaylistDetailsFromStorage;
window.clearPlaylistDetailsStorage = clearPlaylistDetailsStorage;
window.togglePlaylistDetails = togglePlaylistDetails;
window.refreshPlaylistDetails = refreshPlaylistDetails;
window.editTrackVideo = editTrackVideo;
window.selectVideo = selectVideo;
window.cancelVideoSelection = cancelVideoSelection;
window.confirmVideoSelection = confirmVideoSelection;
