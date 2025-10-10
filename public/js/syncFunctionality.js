/**
 * Sync Functionality Module
 * Handles playlist sync operations, HTMX events, and feedback processing
 */

// Function to load playlists (called from HTML connection status script)
// Note: Caching is now handled by HTTP cache headers, no localStorage needed
function loadPlaylistsFromStorage() {
    // Always return false to trigger fresh load (browser HTTP cache will handle caching)
    return false;
}

// Legacy function - kept for backward compatibility but unused
function processPlaylistsContent(target) {
    const playlistItems = target.querySelectorAll('.playlist-item');
    if (playlistItems.length > 0) {
        htmx.process(target);
        Logger.debug('HTMX processed on playlists');
            
            // Add manual event listeners for sync buttons since HTMX processing may not work
            const syncButtons = target.querySelectorAll('.sync-btn');
            Logger.debug('Found sync buttons to attach listeners', { count: syncButtons.length, source: 'cached' });
            
            syncButtons.forEach((button, index) => {
                // Remove any existing listeners to prevent duplicates
                const newButton = button.cloneNode(true);
                button.parentNode.replaceChild(newButton, button);
                
                newButton.addEventListener('click', function(e) {
                    e.preventDefault();
                    Logger.userAction('Sync button clicked', { buttonIndex: index + 1, source: 'cached' });
                    
                    const playlistId = this.dataset.playlistId;
                    const playlistName = this.dataset.playlistName;
                    const targetId = this.getAttribute('hx-target');
                    const url = this.getAttribute('hx-post');
                    
                    Logger.userAction('Manual sync initiated', { playlistName, playlistId });
                    Logger.debug('Sync request details', { targetId, url });
                    
                    // Start real-time progress updates
                    if (typeof startProgressUpdates === 'function') {
                        startProgressUpdates(playlistId, playlistName);
                    }
                    
                    // Disable all sync buttons during sync
                    document.querySelectorAll('.sync-btn').forEach(btn => {
                        btn.disabled = true;
                        btn.classList.add('disabled');
                    });
                    
                    // Clear previous sync results
                    const syncResult = document.getElementById(`sync-result-${playlistId}`);
                    if (syncResult) {
                        syncResult.innerHTML = '';
                    }
                    
                    // Get selected batch size from dropdown
                    const batchSizeSelect = document.getElementById('syncBatchSize');
                    let batchSize = batchSizeSelect ? batchSizeSelect.value : '1';
                    
                    // If "all" is selected, get the actual track count from the playlist
                    if (batchSize === 'all') {
                        const trackCountElement = this.closest('.playlist-item')?.querySelector('.track-count');
                        if (trackCountElement) {
                            const trackCountText = trackCountElement.textContent || '';
                            const trackCountMatch = trackCountText.match(/(\d+)\s+tracks?/);
                            batchSize = trackCountMatch ? trackCountMatch[1] : '999';
                        } else {
                            batchSize = '999'; // Fallback for "all"
                        }
                    }
                    
                    Logger.info('Using batch size for sync', { batchSize, playlistId });
                    
                    // Make manual HTMX request with batch size
                    htmx.ajax('POST', url, {
                        target: targetId,
                        swap: 'innerHTML',
                        values: { batchSize: batchSize }
                    }).then(() => {
                        // Hide the blue progress area since sync is complete
                        const progressDiv = document.getElementById(`progress-${playlistId}`);
                        if (progressDiv) {
                            progressDiv.style.display = 'none';
                        }
                        
                        // Show the sync result area after content is loaded
                        const syncResult = document.getElementById(`sync-result-${playlistId}`);
                        if (syncResult && syncResult.innerHTML.trim() !== '') {
                            // Check if sync was successful by looking for success indicators
                            const isSuccessful = syncResult.innerHTML.includes('successfully') || 
                                                syncResult.innerHTML.includes('data-sync-success="true"');
                            
                            if (isSuccessful) {
                                // For successful syncs, store feedback and trigger playlist refresh for reordering
                                sessionStorage.setItem('pendingSyncFeedback', JSON.stringify({
                                    playlistId: playlistId,
                                    feedbackHtml: syncResult.innerHTML
                                }));
                                
                                // Hide the summary initially - it will appear after refresh in correct position
                                syncResult.style.display = 'none';
                                
                                // Trigger playlist refresh for reordering
                                Logger.info('Triggering playlist refresh for reordering');
                                const refreshBtn = document.getElementById('refresh-playlists-btn');
                                if (refreshBtn) {
                                    htmx.trigger(refreshBtn, 'click');
                                }
                            } else {
                                // Re-enable all sync buttons for failed syncs
                                document.querySelectorAll('.sync-btn').forEach(btn => {
                                    btn.disabled = false;
                                    btn.classList.remove('disabled');
                                });
                            }
                        } else {
                            // Re-enable all sync buttons
                            document.querySelectorAll('.sync-btn').forEach(btn => {
                                btn.disabled = false;
                                btn.classList.remove('disabled');
                            });
                        }
                    }).catch((error) => {
                        Logger.error('Sync request failed', { playlistId, playlistName }, error);
                        
                        // Re-enable all sync buttons even on error
                        document.querySelectorAll('.sync-btn').forEach(btn => {
                            btn.disabled = false;
                            btn.classList.remove('disabled');
                        });
                    });
                });
            });
            Logger.debug('Added manual event listeners to sync buttons', { count: syncButtons.length, source: 'cached' });
        }
        
        return true;
    }
    
    return false;
}

// Function to start real-time progress updates using Server-Sent Events
function startProgressUpdates(playlistId, playlistName) {
    Logger.info('Starting progress updates', { playlistName, playlistId });
    
    // Create and show the enhanced progress area
    const progressDiv = document.getElementById(`progress-${playlistId}`);
    if (progressDiv) {
        progressDiv.innerHTML = `
            <div class="sync-progress-container">
                <div class="d-flex align-items-center mb-2">
                    <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <span class="progress-text">Initializing sync...</span>
                    <span class="progress-percentage ms-auto text-muted">0%</span>
                </div>
                <div class="progress-details text-muted small mb-1" style="display: none;"></div>
                <div class="progress mb-2" style="height: 6px;">
                    <div class="progress-bar bg-primary" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
            </div>
        `;
        progressDiv.style.display = 'block';
        Logger.debug('Enhanced progress area shown', { playlistId });
    }
    
    // Set up Server-Sent Events connection and track it globally
    const eventSource = new EventSource(`/api/progress/playlist/${playlistId}`);
    
    // Track event sources globally to ensure proper cleanup
    if (!window.syncEventSources) {
        window.syncEventSources = {};
    }
    window.syncEventSources[playlistId] = eventSource;
    
    eventSource.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            Logger.debug('Progress update received', data);
            
            if (progressDiv) {
                // Update main progress message
                const progressText = progressDiv.querySelector('.progress-text');
                if (progressText) {
                    progressText.textContent = data.message || 'Processing...';
                }
                
                // Update details (shows action context and x/y progress)
                const progressDetails = progressDiv.querySelector('.progress-details');
                if (progressDetails) {
                    if (data.details) {
                        progressDetails.textContent = data.details;
                        progressDetails.style.display = 'block';
                    } else {
                        progressDetails.style.display = 'none';
                    }
                }
                
                // Update percentage display and progress bar
                const percentage = data.percentage || 0;
                const progressPercentage = progressDiv.querySelector('.progress-percentage');
                if (progressPercentage) {
                    progressPercentage.textContent = `${percentage}%`;
                }
                
                const progressBar = progressDiv.querySelector('.progress-bar');
                if (progressBar) {
                    progressBar.style.width = `${percentage}%`;
                    progressBar.setAttribute('aria-valuenow', percentage);
                }
                
                // Song info is now included in the details line, no separate display needed
            }
        } catch (error) {
            Logger.error('Error parsing progress data', {}, error);
        }
    };
    
    eventSource.onerror = function(event) {
        Logger.info('SSE connection error or closed', { event });
        eventSource.close();
        
        // Clean up global tracking
        if (window.syncEventSources && window.syncEventSources[playlistId]) {
            delete window.syncEventSources[playlistId];
        }
        
        // Don't update progress area on error - let HTMX handle the final state
    };
    
    eventSource.addEventListener('complete', function(event) {
        Logger.info('Sync completed via SSE', { data: event.data });
        eventSource.close();
        
        // Clean up global tracking
        if (window.syncEventSources && window.syncEventSources[playlistId]) {
            delete window.syncEventSources[playlistId];
        }
        
        // Update progress area to show completion
        if (progressDiv) {
            const progressText = progressDiv.querySelector('.progress-text');
            const progressDetails = progressDiv.querySelector('.progress-details');
            const progressBar = progressDiv.querySelector('.progress-bar');
            const progressPercentage = progressDiv.querySelector('.progress-percentage');
            
            if (progressText) progressText.textContent = 'Sync completed!';
            if (progressDetails) progressDetails.textContent = 'Finishing up...';
            if (progressBar) progressBar.style.width = '100%';
            if (progressPercentage) progressPercentage.textContent = '100%';
            
            // Hide progress area after showing completion
            setTimeout(() => {
                progressDiv.style.display = 'none';
            }, 2000);
        }
    });
    
    eventSource.addEventListener('error', function(event) {
        Logger.error('Sync error', { data: event.data });
        eventSource.close();
        
        // Show error in progress area
        if (progressDiv) {
            progressDiv.innerHTML = `
                <div class="sync-progress-container">
                    <div class="d-flex align-items-center text-danger mb-2">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        <span>Sync failed. Please try again.</span>
                    </div>
                    <div class="progress mb-2" style="height: 6px;">
                        <div class="progress-bar bg-danger" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                </div>
            `;
            
            // Hide after delay
            setTimeout(() => {
                progressDiv.style.display = 'none';
            }, 5000);
        }
    });
}

// Expose function globally so it can be called from HTML
window.loadPlaylistsFromStorage = loadPlaylistsFromStorage;
window.startProgressUpdates = startProgressUpdates;

// Initialize sync functionality when DOM is ready
function initializeSyncFunctionality() {
    Logger.info('Sync functionality module initialized');

    // Enhanced sync button handling with real-time progress
    document.addEventListener('htmx:beforeRequest', function(event) {
        if (event.detail.requestConfig.path.includes('/sync/playlist/')) {
            Logger.debug('Sync request detected', { 
                path: event.detail.requestConfig.path,
                method: event.detail.requestConfig.verb,
                target: event.detail.target?.id
            });
            const button = event.detail.elt;
            const playlistId = button.dataset.playlistId;
            const playlistName = button.dataset.playlistName;

            // Get selected batch size from dropdown
            const batchSizeSelect = document.getElementById('syncBatchSize');
            let batchSize = batchSizeSelect ? batchSizeSelect.value : '1';
            
            // If "all" is selected, get the actual track count from the playlist
            if (batchSize === 'all') {
                const trackCountElement = button.closest('.playlist-item')?.querySelector('.track-count');
                if (trackCountElement) {
                    const trackCountText = trackCountElement.textContent || '';
                    const trackCountMatch = trackCountText.match(/(\d+)\s+tracks?/);
                    batchSize = trackCountMatch ? trackCountMatch[1] : '999';
                } else {
                    batchSize = '999'; // Fallback for "all"
                }
            }
            
            // Add batch size to the request
            if (!event.detail.requestConfig.parameters) {
                event.detail.requestConfig.parameters = {};
            }
            event.detail.requestConfig.parameters.batchSize = batchSize;

            Logger.info('Starting sync for playlist', { playlistName, playlistId, batchSize });

            // Start real-time progress updates
            if (typeof startProgressUpdates === 'function') {
                startProgressUpdates(playlistId, playlistName);
            }

            // Disable all sync buttons during sync
            document.querySelectorAll('.sync-btn').forEach(btn => {
                btn.disabled = true;
                btn.classList.add('disabled');
            });

            // Clear previous sync results
            const syncResult = document.getElementById(`sync-result-${playlistId}`);
            if (syncResult) {
                syncResult.innerHTML = '';
            }
        }
    });

    // Handle sync request completion
    document.addEventListener('htmx:afterRequest', function(event) {
        const status = event.detail.xhr.status;
        
        // Handle sync request completion
        if (event.detail.requestConfig?.path?.includes('/sync/playlist/')) {
            const target = event.detail.target;
            const playlistId = target.id.replace('sync-result-', '');
            
            Logger.info('Sync request completed', { playlistId, status });
            
            // Close any open SSE connections for this playlist to prevent conflicts
            if (window.syncEventSources && window.syncEventSources[playlistId]) {
                window.syncEventSources[playlistId].close();
                delete window.syncEventSources[playlistId];
            }
            
            // Hide the progress area since sync is complete
            const progressDiv = document.getElementById(`progress-${playlistId}`);
            if (progressDiv) {
                progressDiv.style.display = 'none';
            }
            
            // Show the sync result area after content is loaded
            const syncResult = document.getElementById(`sync-result-${playlistId}`);
            if (syncResult && syncResult.innerHTML.trim() !== '' && status >= 200 && status < 300) {
                // Check if sync was successful by looking for success indicators
                const isSuccessful = syncResult.innerHTML.includes('successfully') || 
                                    syncResult.innerHTML.includes('data-sync-success="true"');
                
                if (isSuccessful) {
                    // For successful syncs, store feedback and trigger playlist refresh for reordering
                    sessionStorage.setItem('pendingSyncFeedback', JSON.stringify({
                        playlistId: playlistId,
                        feedbackHtml: syncResult.innerHTML
                    }));
                    
                    // Hide the summary initially - it will appear after refresh in correct position
                    syncResult.style.display = 'none';
                    
                    // Check if playlist details are currently open and refresh them
                    const detailsContainer = document.getElementById(`details-${playlistId}`);
                    const expandArea = document.querySelector(`[onclick*="togglePlaylistDetails('${playlistId}'"]`);
                    const isDetailsOpen = expandArea && expandArea.dataset.expanded === 'true';
                    
                    if (isDetailsOpen && detailsContainer) {
                        Logger.info('Refreshing open playlist details after sync', { playlistId });
                        // Store that details were open so we can refresh them after playlist reload
                        sessionStorage.setItem('refreshDetailsAfterSync', JSON.stringify({
                            playlistId: playlistId,
                            wasOpen: true
                        }));
                    }
                    
                    // Trigger playlist refresh for reordering
                    Logger.info('Triggering playlist refresh for reordering');
                    const refreshBtn = document.getElementById('refresh-playlists-btn');
                    if (refreshBtn) {
                        htmx.trigger(refreshBtn, 'click');
                    }
                } else {
                    // Re-enable all sync buttons for failed syncs
                    document.querySelectorAll('.sync-btn').forEach(btn => {
                        btn.disabled = false;
                        btn.classList.remove('disabled');
                    });
                }
            } else {
                // Re-enable all sync buttons for failed requests
                document.querySelectorAll('.sync-btn').forEach(btn => {
                    btn.disabled = false;
                    btn.classList.remove('disabled');
                });
            }
        }

        // Handle playlist refresh completion to show sync feedback
        if (event.detail.requestConfig?.path?.includes('/auth/spotify/playlists')) {
            const pendingFeedback = sessionStorage.getItem('pendingSyncFeedback');
            const pendingDetailsRefresh = sessionStorage.getItem('refreshDetailsAfterSync');
            
            if (pendingFeedback && status >= 200 && status < 300) {
                try {
                    const feedback = JSON.parse(pendingFeedback);
                    const playlistId = feedback.playlistId;
                    const feedbackHtml = feedback.feedbackHtml;

                    // Find the synced playlist in the refreshed list
                    setTimeout(() => {
                        const playlistElement = document.querySelector(`[data-playlist-id="${playlistId}"]`);
                        if (playlistElement && feedbackHtml) {
                            // Find the playlist's sync result area within the row
                            const syncResultArea = playlistElement.querySelector(`#sync-result-${playlistId}`);
                            if (syncResultArea) {
                                // Place feedback within the playlist's sync result area
                                syncResultArea.innerHTML = feedbackHtml;
                                syncResultArea.style.display = 'block';

                                // Add dismissal functionality
                                const dismissButton = syncResultArea.querySelector('.btn-close');
                                if (dismissButton) {
                                    dismissButton.addEventListener('click', function() {
                                        syncResultArea.style.display = 'none';
                                    });
                                }

                                // Auto-hide after 15 seconds with hover cancellation
                                let fadeTimeout;
                                let fadeInProgress = false;

                                const startFade = () => {
                                    fadeTimeout = setTimeout(() => {
                                        if (syncResultArea && syncResultArea.style.display !== 'none') {
                                            fadeInProgress = true;
                                            syncResultArea.style.opacity = '0';
                                            syncResultArea.style.transition = 'opacity 0.5s ease-out';
                                            setTimeout(() => {
                                                if (fadeInProgress) {
                                                    syncResultArea.style.display = 'none';
                                                    // Reset for next use
                                                    syncResultArea.style.opacity = '1';
                                                    syncResultArea.style.transition = '';
                                                }
                                            }, 500);
                                        }
                                    }, 15000); // 15 second delay before fade starts
                                };

                                const cancelFade = () => {
                                    if (fadeTimeout) {
                                        clearTimeout(fadeTimeout);
                                        fadeTimeout = null;
                                    }
                                    if (fadeInProgress) {
                                        fadeInProgress = false;
                                        syncResultArea.style.opacity = '1';
                                        syncResultArea.style.transition = '';
                                    }
                                };

                                // Add hover listeners to cancel fade
                                syncResultArea.addEventListener('mouseenter', cancelFade);

                                // Start the fade timer
                                startFade();
                            }

                            // Scroll to the synced playlist with a small delay to ensure content is rendered
                            setTimeout(() => {
                                playlistElement.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'center'
                                });
                                Logger.info('Scrolled to synced playlist', { playlistId });
                            }, 200);
                        }

                        // Handle playlist details refresh if they were open
                        if (pendingDetailsRefresh) {
                            try {
                                const detailsRefresh = JSON.parse(pendingDetailsRefresh);
                                if (detailsRefresh.playlistId === playlistId && detailsRefresh.wasOpen) {
                                    Logger.info('Refreshing playlist details after sync', { playlistId });
                                    
                                    // Wait a bit longer to ensure playlist is fully rendered
                                    setTimeout(() => {
                                        // Find the expand area in the refreshed playlist
                                        const expandArea = document.querySelector(`[onclick*="togglePlaylistDetails('${playlistId}'"]`);
                                        const detailsContainer = document.getElementById(`details-${playlistId}`);
                                        
                                        if (expandArea && detailsContainer) {
                                            // Set the details as expanded
                                            expandArea.dataset.expanded = 'true';
                                            const indicator = expandArea.querySelector('.expand-indicator');
                                            if (indicator) {
                                                indicator.textContent = '▲';
                                                indicator.style.color = '#ff0040';
                                            }
                                            expandArea.title = 'Hide track details';
                                            
                                            // Show the container and refresh the details
                                            detailsContainer.style.display = 'block';
                                            
                                            // Use the refreshPlaylistDetails function if available
                                            if (typeof refreshPlaylistDetails === 'function') {
                                                refreshPlaylistDetails(playlistId);
                                            } else {
                                                // Fallback: manually refresh using HTMX
                                                htmx.ajax('GET', `/api/playlistDetails/playlist/${playlistId}`, {
                                                    target: `#details-${playlistId}`,
                                                    swap: 'innerHTML'
                                                }).then(() => {
                                                    Logger.info('Playlist details refreshed after sync', { playlistId });
                                                }).catch((error) => {
                                                    Logger.error('Error refreshing playlist details after sync', { playlistId }, error);
                                                });
                                            }
                                        }
                                    }, 300);
                                }
                                
                                // Clear the pending details refresh
                                sessionStorage.removeItem('refreshDetailsAfterSync');
                            } catch (error) {
                                Logger.error('Error processing pending details refresh', {}, error);
                                sessionStorage.removeItem('refreshDetailsAfterSync');
                            }
                        }

                        // Clear the pending feedback
                        sessionStorage.removeItem('pendingSyncFeedback');
                    }, 100);

                } catch (error) {
                    Logger.error('Error processing pending sync feedback', {}, error);
                    sessionStorage.removeItem('pendingSyncFeedback');
                }
            }
        }

        // Re-enable sync buttons after any failed request
        if (status >= 400 && event.detail.requestConfig?.path?.includes('/sync/playlist/')) {
            document.querySelectorAll('.sync-btn').forEach(btn => {
                btn.disabled = false;
                btn.classList.remove('disabled');
            });
        }
    });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSyncFunctionality);
} else {
    initializeSyncFunctionality();
}

// Make initialization function available globally if needed
window.initializeSyncFunctionality = initializeSyncFunctionality;
