/**
 * Playlist Storage Module
 * Handles localStorage persistence for Spotify playlists
 */

// Playlist persistence functions
function savePlaylistsToStorage(playlistsHtml) {
    try {
        localStorage.setItem('spotify_playlists', playlistsHtml);
        localStorage.setItem('spotify_playlists_timestamp', Date.now().toString());
        console.log('Playlists saved to localStorage');
    } catch (error) {
        console.warn('Failed to save playlists to localStorage:', error);
    }
}

function clearPlaylistsStorage() {
    try {
        localStorage.removeItem('spotify_playlists');
        localStorage.removeItem('spotify_playlists_timestamp');
        console.log('Cleared playlist cache');
    } catch (error) {
        console.warn('Failed to clear playlist cache:', error);
    }
}

// Basic cache checking function (without complex sync button handling)
function getCachedPlaylistsData() {
    try {
        const timestamp = localStorage.getItem('spotify_playlists_timestamp');
        const playlistsHtml = localStorage.getItem('spotify_playlists');
        
        if (timestamp && playlistsHtml) {
            const ageMs = Date.now() - parseInt(timestamp);
            const ageMinutes = ageMs / (1000 * 60);
            
            // Cache expires after 15 minutes
            if (ageMinutes < 15) {
                return {
                    html: playlistsHtml,
                    ageMinutes: Math.round(ageMinutes),
                    isValid: true
                };
            } else {
                console.log('Cached playlists expired, will refresh');
                clearPlaylistsStorage();
                return { isValid: false };
            }
        }
    } catch (error) {
        console.warn('Failed to load playlists from localStorage:', error);
    }
    return { isValid: false };
}

// Make functions available globally
window.savePlaylistsToStorage = savePlaylistsToStorage;
window.clearPlaylistsStorage = clearPlaylistsStorage;
window.getCachedPlaylistsData = getCachedPlaylistsData;
