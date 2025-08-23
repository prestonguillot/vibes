/**
 * Connection Status Module
 * Handles authentication status checking and connection button management
 */

// Flag to prevent infinite auto-loading
let hasAutoLoaded = false;

// Function to update connection status
async function updateConnectionStatus() {
    try {
        Logger.info('Checking authentication status');
        
        // Record start time for minimum loading duration
        const loadingStartTime = Date.now();
        
        // Check if we're returning from OAuth and show loading states
        const spotifyConnecting = sessionStorage.getItem('spotify_connecting');
        const youtubeConnecting = sessionStorage.getItem('youtube_connecting');
        
        if (spotifyConnecting) {
            const spotifyStatus = document.getElementById('spotify-status');
            spotifyStatus.innerHTML = '<button class="btn btn-success connect-btn disabled" disabled><span class="d-flex align-items-center justify-content-center"><div class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" style="width: 0.8rem; height: 0.8rem;"></div>Connecting...</span></button>';
            spotifyStatus.style.opacity = 1;
        }
        
        if (youtubeConnecting) {
            const youtubeStatus = document.getElementById('youtube-status');
            youtubeStatus.innerHTML = '<button class="btn btn-danger connect-btn disabled" disabled><span class="d-flex align-items-center justify-content-center"><div class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" style="width: 0.8rem; height: 0.8rem;"></div>Connecting...</span></button>';
            youtubeStatus.style.opacity = 1;
        }
        
        const response = await fetch('/api/status');
        const status = await response.json();

        Logger.info('Authentication status received', status);

        // Ensure minimum loading duration of 1 second
        const loadingDuration = Date.now() - loadingStartTime;
        const minimumDuration = 1000; // 1 second
        
        if (loadingDuration < minimumDuration) {
            const remainingTime = minimumDuration - loadingDuration;
            Logger.debug('Waiting for minimum loading duration', { remainingTime });
            await new Promise(resolve => setTimeout(resolve, remainingTime));
        }

        // Clear loading states from sessionStorage
        sessionStorage.removeItem('spotify_connecting');
        sessionStorage.removeItem('youtube_connecting');
        sessionStorage.removeItem('spotify_original_content');
        sessionStorage.removeItem('spotify_original_classes');
        sessionStorage.removeItem('youtube_original_content');
        sessionStorage.removeItem('youtube_original_classes');

        // Update Spotify status with smooth transitions
        const spotifyStatus = document.getElementById('spotify-status');
        if (status.spotify) {
            spotifyStatus.innerHTML =
                '<button class="btn btn-success connect-btn connected" disabled>Connected</button>';
            spotifyStatus.style.opacity = 1;
            Logger.auth('Spotify', 'authenticated');
        } else {
            spotifyStatus.innerHTML =
                '<button class="btn btn-success connect-btn" onclick="connectToService(\'/auth/spotify/login\', this, \'spotify\')">Connect Spotify</button>';
            spotifyStatus.style.opacity = 1;
            Logger.auth('Spotify', 'authentication required');
        }

        // Update YouTube status with smooth transitions
        const youtubeStatus = document.getElementById('youtube-status');
        if (status.youtube) {
            youtubeStatus.innerHTML =
                '<button class="btn btn-danger connect-btn connected" disabled>Connected</button>';
            youtubeStatus.style.opacity = 1;
            Logger.auth('YouTube', 'authenticated');
        } else {
            youtubeStatus.innerHTML =
                '<button class="btn btn-danger connect-btn" onclick="connectToService(\'/auth/youtube/login\', this, \'youtube\')">Connect YouTube</button>';
            youtubeStatus.style.opacity = 1;
            Logger.auth('YouTube', 'authentication required');
        }

        // Auto-load playlists if both services are connected and we haven't auto-loaded yet
        if (status.spotify && status.youtube && !hasAutoLoaded) {
            Logger.info('Both services connected, auto-loading playlists');
            hasAutoLoaded = true;
            
            // Try to load from cache first
            const loadedFromCache = loadPlaylistsFromStorage();
            
            if (!loadedFromCache) {
                // If no cache, trigger fresh load
                const refreshBtn = document.getElementById('refresh-playlists-btn');
                if (refreshBtn) {
                    Logger.info('No cached playlists found, loading fresh playlists');
                    refreshBtn.click();
                } else {
                    Logger.warn('Refresh button not found for auto-loading');
                }
            }
        }

        // Check URL parameters for immediate feedback after OAuth redirect (but don't recurse)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('spotify') === 'connected' || urlParams.get('youtube') === 'connected') {
            Logger.info('OAuth redirect detected, status already updated');
            // Clear URL parameters to prevent confusion
            if (window.history.replaceState) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }

        if (urlParams.get('error')) {
            const error = urlParams.get('error');
            const alertDiv = document.createElement('div');
            alertDiv.className = 'alert alert-danger alert-dismissible fade show';
            alertDiv.innerHTML = `
                <strong>Error:</strong> ${error.replace(/_/g, ' ')}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            `;
            document.querySelector('.container').prepend(alertDiv);
        }

    } catch (error) {
        Logger.error('Error checking connection status', {}, error);
        
        // Show error state with fallback connect buttons
        document.getElementById('spotify-status').innerHTML =
            '<button class="btn btn-success connect-btn" onclick="connectToService(\'/auth/spotify/login\', this, \'spotify\')">Connect Spotify</button>';
        document.getElementById('spotify-status').style.opacity = 1;

        document.getElementById('youtube-status').innerHTML =
            '<button class="btn btn-danger connect-btn" onclick="connectToService(\'/auth/youtube/login\', this, \'youtube\')">Connect YouTube</button>';
        document.getElementById('youtube-status').style.opacity = 1;
    }
}

// Simple connect function using direct navigation (no popup)
function connectToService(url, button, service) {
    Logger.userAction('Connect to service', { url, service });

    // Store original button content and classes
    const originalContent = button.innerHTML;
    const originalClasses = button.className;

    // Show loading state with spinner inside button
    button.innerHTML = '<span class="d-flex align-items-center justify-content-center"><div class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" style="width: 0.8rem; height: 0.8rem;"></div>Connecting...</span>';
    button.disabled = true;
    button.classList.add('disabled');

    // Store loading state in sessionStorage so it persists through redirect
    sessionStorage.setItem(`${service}_connecting`, 'true');
    sessionStorage.setItem(`${service}_original_content`, originalContent);
    sessionStorage.setItem(`${service}_original_classes`, originalClasses);

    // Use direct navigation to OAuth endpoint
    window.location.href = url;
}

// Initialize connection status checking when DOM is ready
function initializeConnectionStatus() {
    Logger.info('Connection status module initialized');
    
    // Clear any leftover sync results from previous sessions
    document.querySelectorAll('[id^="sync-result-"]').forEach(syncResult => {
        syncResult.innerHTML = '';
    });
    
    // Check connection status immediately
    updateConnectionStatus();
    
    // Set up periodic status checking (every 5 minutes instead of 30 seconds)
    // Only check periodically if user is actively using the page
    let statusCheckInterval = setInterval(() => {
        // Only check if page is visible (user is actively using it)
        if (!document.hidden) {
            updateConnectionStatus();
        }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Clear interval when page becomes hidden for extended periods
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Page is hidden, reduce checking
            clearInterval(statusCheckInterval);
        } else {
            // Page is visible again, resume checking and do immediate check
            updateConnectionStatus();
            statusCheckInterval = setInterval(() => {
                if (!document.hidden) {
                    updateConnectionStatus();
                }
            }, 5 * 60 * 1000);
        }
    });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeConnectionStatus);
} else {
    // DOM is already ready
    initializeConnectionStatus();
}

// Expose functions globally so they can be called from other modules if needed
window.updateConnectionStatus = updateConnectionStatus;
window.connectToService = connectToService;
