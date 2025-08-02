/**
 * Connection Status Module
 * Handles authentication status checking and connection button management
 */

// Flag to prevent infinite auto-loading
let hasAutoLoaded = false;

// Function to update connection status
async function updateConnectionStatus() {
    try {
        console.log('Checking authentication status...');
        const response = await fetch('/api/status');
        const status = await response.json();

        console.log('Authentication status:', status);

        // Update Spotify status
        if (status.spotify) {
            document.getElementById('spotify-status').innerHTML =
                '<button class="btn btn-success connect-btn" disabled>Connected</button>';
            document.getElementById('spotify-status').style.opacity = 1;
            console.log('✅ Spotify: Already authenticated');
        } else {
            document.getElementById('spotify-status').innerHTML =
                '<button class="btn btn-success connect-btn" onclick="connectToService(\'/auth/spotify/login\', this)">Connect Spotify</button>';
            document.getElementById('spotify-status').style.opacity = 1;
            console.log('🔑 Spotify: Authentication required');
        }

        // Update YouTube status
        if (status.youtube) {
            document.getElementById('youtube-status').innerHTML =
                '<button class="btn btn-danger connect-btn" disabled>Connected</button>';
            document.getElementById('youtube-status').style.opacity = 1;
            console.log('✅ YouTube: Already authenticated');
        } else {
            document.getElementById('youtube-status').innerHTML =
                '<button class="btn btn-danger connect-btn" onclick="connectToService(\'/auth/youtube/login\', this)">Connect YouTube</button>';
            document.getElementById('youtube-status').style.opacity = 1;
            console.log('🔑 YouTube: Authentication required');
        }

        // Auto-load playlists if both services are connected and we haven't auto-loaded yet
        if (status.spotify && status.youtube && !hasAutoLoaded) {
            console.log('🔄 Both services connected, auto-loading playlists...');
            hasAutoLoaded = true;
            
            // Try to load from cache first
            const loadedFromCache = loadPlaylistsFromStorage();
            
            if (!loadedFromCache) {
                // If no cache, trigger fresh load
                const refreshBtn = document.getElementById('refresh-playlists-btn');
                if (refreshBtn) {
                    console.log('📡 No cached playlists found, loading fresh playlists...');
                    refreshBtn.click();
                } else {
                    console.warn('⚠️ Refresh button not found for auto-loading');
                }
            }
        }

        // Check URL parameters for immediate feedback after OAuth redirect (but don't recurse)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('spotify') === 'connected' || urlParams.get('youtube') === 'connected') {
            console.log('OAuth redirect detected, status already updated above');
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
        console.error('Error checking connection status:', error);
        
        // Show error state with fallback connect buttons
        document.getElementById('spotify-status').innerHTML =
            '<button class="btn btn-success connect-btn" onclick="connectToService(\'/auth/spotify/login\', this)">Connect Spotify</button>';
        document.getElementById('spotify-status').style.opacity = 1;

        document.getElementById('youtube-status').innerHTML =
            '<button class="btn btn-danger connect-btn" onclick="connectToService(\'/auth/youtube/login\', this)">Connect YouTube</button>';
        document.getElementById('youtube-status').style.opacity = 1;
    }
}

// Simple connect function using direct navigation (no popup)
function connectToService(url, button) {
    console.log(`Connecting to service: ${url}`);

    // Store original button text
    const originalText = button.innerHTML;

    // Show loading state
    button.innerHTML = 'Connecting...';
    button.disabled = true;
    button.classList.add('disabled');

    // Use direct navigation to OAuth endpoint
    window.location.href = url;
}

// Initialize connection status checking when DOM is ready
function initializeConnectionStatus() {
    console.log('Connection status initialized at:', new Date().toISOString());
    
    // Clear any leftover sync results from previous sessions
    document.querySelectorAll('[id^="sync-result-"]').forEach(syncResult => {
        syncResult.innerHTML = '';
    });
    
    // Check connection status immediately
    updateConnectionStatus();
    
    // Set up periodic status checking (every 30 seconds)
    setInterval(updateConnectionStatus, 30000);
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
