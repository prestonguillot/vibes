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

  eventSource.onerror = () => {
    eventSource.close();
    sseConnections.delete(playlistId);
  };
}

// Close SSE connection for a playlist
function closeSSE(playlistId) {
  const eventSource = sseConnections.get(playlistId);
  if (eventSource) {
    eventSource.close();
    sseConnections.delete(playlistId);
  }
}
