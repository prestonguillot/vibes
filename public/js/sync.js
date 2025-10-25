/**
 * Sync Status Box Manager
 * Single component with multiple states: working, success, warning, error
 */

// Track SSE connections for cleanup
const sseConnections = new Map();
const statusBoxTimers = new Map();

// Helper function to set status box state
function setStatusBoxState(playlistId, state, content = '') {
  const statusBox = document.getElementById(`sync-status-${playlistId}`);
  if (!statusBox) return;

  // Cancel any pending timers
  if (statusBoxTimers.has(playlistId)) {
    clearTimeout(statusBoxTimers.get(playlistId));
    statusBoxTimers.delete(playlistId);
  }

  // Remove fade-out class if present
  statusBox.classList.remove('fade-out');

  // Update state
  statusBox.className = `sync-status-box sync-status-${state}`;
  statusBox.setAttribute('data-state', state);

  // Update content if provided
  if (content) {
    statusBox.querySelector('.sync-status-content').innerHTML = content;
  }

  // Setup close button handler for dismissible states
  if (['success', 'warning', 'error'].includes(state)) {
    const closeBtn = statusBox.querySelector('.sync-status-close');
    if (closeBtn) {
      closeBtn.onclick = () => hideStatusBox(playlistId);
    }
  }

  // Auto-fade for success only (not warning or error)
  if (state === 'success') {
    const timer = setTimeout(() => {
      hideStatusBox(playlistId);
    }, 5000);
    statusBoxTimers.set(playlistId, timer);
  }
}

// Helper function to hide status box
function hideStatusBox(playlistId) {
  const statusBox = document.getElementById(`sync-status-${playlistId}`);
  if (!statusBox) return;

  // Cancel any pending timer
  if (statusBoxTimers.has(playlistId)) {
    clearTimeout(statusBoxTimers.get(playlistId));
    statusBoxTimers.delete(playlistId);
  }

  statusBox.classList.add('fade-out');
  setTimeout(() => {
    statusBox.classList.remove('fade-out');
    statusBox.style.display = 'none';
  }, 300);
}

// Show progress and start SSE when sync begins
document.body.addEventListener('htmx:beforeRequest', (event) => {
  const path = event.detail.requestConfig.path;
  if (!path || !path.includes('/sync/playlist/')) return;

  const playlistId = path.split('/').pop();

  // Show status box in working state
  const statusBox = document.getElementById(`sync-status-${playlistId}`);
  if (statusBox) {
    statusBox.style.display = 'block';
    setStatusBoxState(playlistId, 'working', `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="spinner-border spinner-border-sm text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <span>Starting sync...</span>
      </div>
    `);
  }

  startSSE(playlistId);
});

// Handle sync completion - update status box to success
document.body.addEventListener('htmx:afterRequest', (event) => {
  const path = event.detail.requestConfig?.path;
  if (!path || !path.includes('/sync/playlist/')) return;

  const playlistId = path.split('/').pop();

  closeSSE(playlistId);

  // Find the sync feedback content that HTMX placed in sync-result
  const syncResultDiv = document.getElementById(`sync-result-${playlistId}`);
  if (syncResultDiv) {
    const feedbackContent = syncResultDiv.innerHTML;

    // Update status box to success with the feedback content
    setStatusBoxState(playlistId, 'success', feedbackContent);

    // Clear the sync-result div since content is now in status box
    syncResultDiv.innerHTML = '';
  }
});

// Handle HTMX errors specifically for sync operations
document.body.addEventListener('htmx:sendError', (event) => {
  const path = event.detail?.requestConfig?.path;
  if (!path || !path.includes('/sync/playlist/')) return;

  Logger.error('HTMX send error for sync request', { detail: event.detail });

  const playlistId = path.split('/').pop();

  closeSSE(playlistId);

  // Show error state (does not auto-fade)
  // If there's feedback content from the server, use it; otherwise show generic error
  const syncResultDiv = document.getElementById(`sync-result-${playlistId}`);
  let errorContent = '<strong>Sync failed</strong><br>Please try again';

  if (syncResultDiv) {
    const feedbackContent = syncResultDiv.innerHTML;
    if (feedbackContent) {
      errorContent = feedbackContent;
    }
    syncResultDiv.innerHTML = '';
  }

  setStatusBoxState(playlistId, 'error', errorContent);
});

// Start SSE connection for a playlist
function startSSE(playlistId) {
  // Close any existing connection first
  closeSSE(playlistId);

  const eventSource = new EventSource(`/api/progress/playlist/${playlistId}`);
  sseConnections.set(playlistId, eventSource);

  eventSource.onmessage = (event) => {
    const statusBox = document.getElementById(`sync-status-${playlistId}`);
    if (!statusBox) return;

    // Check if this is a control message (JSON) or HTML content
    // Control messages like {"type":"connected"} should be ignored
    if (event.data.startsWith('{') || event.data.startsWith('[')) {
      // This is JSON - ignore it (it's a control message)
      return;
    }

    // Server sends progress HTML - update the content while keeping working state
    const contentDiv = statusBox.querySelector('.sync-status-content');
    if (contentDiv) {
      contentDiv.innerHTML = event.data;
    }
  };

  // Listen for the "close" event from server (graceful shutdown)
  eventSource.addEventListener('close', () => {
    Logger.info('SSE connection closed gracefully', { playlistId });
    closeSSE(playlistId);
  });

  eventSource.onerror = (error) => {
    // Only clean up this specific connection, don't interfere with anything else
    Logger.warn('SSE connection error', { playlistId }, error);
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
      Logger.warn('Error closing SSE connection', { playlistId }, error);
    } finally {
      // Always remove from map, regardless of close success
      sseConnections.delete(playlistId);
    }
  }
}
