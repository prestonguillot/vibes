/**
 * Sync Functionality Module
 * Handles playlist sync operations, HTMX events, and feedback processing
 */

// Function to load playlists from storage (called from HTML connection status script)
function loadPlaylistsFromStorage() {
    const cachedData = getCachedPlaylistsData();
    
    if (cachedData.isValid) {
        Logger.cache('load', 'spotify_playlists', { ageMinutes: cachedData.ageMinutes });
        const target = document.getElementById('playlists-content');
        target.innerHTML = cachedData.html;
        
        // Process HTMX attributes on cached content
        const playlistItems = target.querySelectorAll('.playlist-item');
        if (playlistItems.length > 0) {
            htmx.process(target);
            Logger.debug('HTMX processed on cached playlists');
            
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
                    
                    // Make manual HTMX request
                    htmx.ajax('POST', url, {
                        target: targetId,
                        swap: 'innerHTML'
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
    
    // Create and show the blue progress area
    const progressDiv = document.getElementById(`progress-${playlistId}`);
    if (progressDiv) {
        progressDiv.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <span class="progress-text">Initializing sync...</span>
            </div>
        `;
        progressDiv.style.display = 'block';
        Logger.debug('Progress area shown', { playlistId });
    }
    
    // Set up Server-Sent Events connection
    const eventSource = new EventSource(`/api/progress/playlist/${playlistId}`);
    
    eventSource.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            Logger.debug('Progress update received', data);
            
            if (progressDiv) {
                const progressText = progressDiv.querySelector('.progress-text');
                if (progressText) {
                    progressText.textContent = data.message || 'Processing...';
                }
                
                // Update progress bar if percentage is provided
                if (data.progress !== undefined) {
                    let progressBar = progressDiv.querySelector('.progress-bar');
                    if (!progressBar) {
                        // Create progress bar if it doesn't exist
                        const progressContainer = document.createElement('div');
                        progressContainer.className = 'progress mt-2';
                        progressContainer.style.height = '4px';
                        
                        progressBar = document.createElement('div');
                        progressBar.className = 'progress-bar bg-primary';
                        progressBar.setAttribute('role', 'progressbar');
                        
                        progressContainer.appendChild(progressBar);
                        progressDiv.appendChild(progressContainer);
                    }
                    
                    progressBar.style.width = `${data.progress}%`;
                    progressBar.setAttribute('aria-valuenow', data.progress);
                }
            }
        } catch (error) {
            Logger.error('Error parsing progress data', {}, error);
        }
    };
    
    eventSource.onerror = function(event) {
        Logger.info('SSE connection error or closed', { event });
        eventSource.close();
        
        // Update progress area to show completion
        if (progressDiv) {
            const progressText = progressDiv.querySelector('.progress-text');
            if (progressText) {
                progressText.textContent = 'Sync completed';
            }
            
            // Hide progress area after a short delay
            setTimeout(() => {
                progressDiv.style.display = 'none';
            }, 1000);
        }
    };
    
    eventSource.addEventListener('complete', function(event) {
        Logger.info('Sync completed', { data: event.data });
        eventSource.close();
        
        // Hide progress area
        if (progressDiv) {
            progressDiv.style.display = 'none';
        }
    });
    
    eventSource.addEventListener('error', function(event) {
        Logger.error('Sync error', { data: event.data });
        eventSource.close();
        
        // Show error in progress area
        if (progressDiv) {
            progressDiv.innerHTML = `
                <div class="text-danger">
                    <i class="fas fa-exclamation-triangle me-1"></i>
                    Sync failed. Please try again.
                </div>
            `;
            
            // Hide after delay
            setTimeout(() => {
                progressDiv.style.display = 'none';
            }, 3000);
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
            Logger.debug('Sync request detected', event.detail);
            const button = event.detail.elt;
            const playlistId = button.dataset.playlistId;
            const playlistName = button.dataset.playlistName;

            Logger.info('Starting sync for playlist', { playlistName, playlistId });

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
            
            // Hide the blue progress area since sync is complete
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

                            // Scroll to the synced playlist
                            playlistElement.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center'
                            });
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
