/**
 * Simplified Sync Module - HTMX-friendly approach
 * Handles only SSE progress updates; HTMX handles all other interactions
 */

// Track SSE connections for cleanup
const sseConnections = new Map();

// Show progress and start SSE when sync begins
document.body.addEventListener('htmx:beforeRequest', (event) => {
  const path = event.detail.requestConfig.path;
  if (!path || !path.includes('/sync/playlist/')) return;

  const playlistId = path.split('/').pop();
  const progressDiv = document.getElementById(`progress-${playlistId}`);

  if (progressDiv) {
    progressDiv.style.display = 'block';
    startSSE(playlistId);
  }
});

// Hide progress and close SSE when sync completes
document.body.addEventListener('htmx:afterRequest', (event) => {
  const path = event.detail.requestConfig?.path;
  if (!path || !path.includes('/sync/playlist/')) return;

  const playlistId = path.split('/').pop();

  closeSSE(playlistId);

  // Hide progress after a short delay
  setTimeout(() => {
    const progressDiv = document.getElementById(`progress-${playlistId}`);
    if (progressDiv) progressDiv.style.display = 'none';
  }, 2000);
});

// Handle HTMX errors specifically for sync operations
document.body.addEventListener('htmx:sendError', (event) => {
  const path = event.detail?.requestConfig?.path;
  if (!path || !path.includes('/sync/playlist/')) return;

  console.error('HTMX send error for sync request:', event.detail);

  const playlistId = path.split('/').pop();

  // Clean up SSE connection on error
  closeSSE(playlistId);

  // Hide progress on error
  const progressDiv = document.getElementById(`progress-${playlistId}`);
  if (progressDiv) {
    progressDiv.style.display = 'none';
  }
});

// Start SSE connection for a playlist
function startSSE(playlistId) {
  // Close any existing connection first
  closeSSE(playlistId);

  const eventSource = new EventSource(`/api/progress/playlist/${playlistId}`);
  sseConnections.set(playlistId, eventSource);

  eventSource.onmessage = (event) => {
    const progressDiv = document.getElementById(`progress-${playlistId}`);
    if (!progressDiv) return;

    // Check if this is a control message (JSON) or HTML content
    // Control messages like {"type":"connected"} should be ignored
    if (event.data.startsWith('{') || event.data.startsWith('[')) {
      // This is JSON - ignore it (it's a control message)
      return;
    }

    // Server sends HTML directly - just swap it in
    progressDiv.innerHTML = event.data;
  };

  // Listen for the "close" event from server (graceful shutdown)
  eventSource.addEventListener('close', () => {
    console.log(`SSE connection closed gracefully for playlist ${playlistId}`);
    closeSSE(playlistId);
  });

  eventSource.onerror = (error) => {
    // Only clean up this specific connection, don't interfere with anything else
    console.log(`SSE connection error for playlist ${playlistId}`, error);
    const conn = sseConnections.get(playlistId);
    if (conn === eventSource) {
      eventSource.close();
      sseConnections.delete(playlistId);
    }
  };
}

// Close SSE connection for a playlist
function closeSSE(playlistId) {
  const eventSource = sseConnections.get(playlistId);
  if (eventSource) {
    try {
      // Check if connection is still open before closing
      if (eventSource.readyState !== EventSource.CLOSED) {
        eventSource.close();
      }
    } catch (error) {
      console.warn(`Error closing SSE connection for playlist ${playlistId}:`, error);
    } finally {
      // Always remove from map, regardless of close success
      sseConnections.delete(playlistId);
    }
  }
}
