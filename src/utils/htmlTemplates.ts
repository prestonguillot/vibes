/**
 * HTML template functions for HTMX responses
 * These return HTML fragments as strings to be sent by route handlers
 */

// OAuth error page
export function oauthErrorPage(service: 'Spotify' | 'YouTube'): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${service} Connection Failed</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          text-align: center;
          padding: 50px;
          background: #dc3545;
          color: white;
        }
        .error {
          font-size: 24px;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="error">${service} Connection Failed</div>
      <p>Please try again. You can close this window.</p>
      <script>
        setTimeout(() => {
          window.close();
        }, 3000);
      </script>
    </body>
    </html>
  `;
}

// Generic error message component
export function errorMessage(options: {
  type?: 'danger' | 'warning' | 'info';
  title?: string;
  message: string;
  details?: string;
}): string {
  const { type = 'danger', title, message, details } = options;

  return `
    <div class="alert alert-${type}">
      ${title ? `<h6>${title}</h6>` : ''}
      <p>${message}</p>
      ${details ? `<small class="text-muted">${details}</small>` : ''}
    </div>
  `;
}

// Playlist item component
export function playlistItem(playlist: {
  id: string;
  name: string;
  tracksTotal: number;
  spotifyUrl: string;
  youtubeUrl?: string;
  isSynced: boolean;
  syncIcon?: string;
  buttonText: string;
  buttonClass: string;
}): string {
  const { id, name, tracksTotal, spotifyUrl, youtubeUrl, isSynced, syncIcon = '', buttonText, buttonClass } = playlist;

  return `
    <div class="playlist-item" data-playlist-id="${id}">
      <div class="playlist-item__header">
        <div class="playlist-info">
          <h5 class="mb-1">${syncIcon}${escapeHtml(name)}</h5>
          <p class="text-muted mb-1">${tracksTotal} tracks</p>

          <!-- Playlist Links -->
          <div class="playlist-links">
            <a href="${spotifyUrl}" target="_blank"
               class="playlist-link playlist-link--spotify"
               title="Open in Spotify">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="me-1">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              Spotify
            </a>
            ${youtubeUrl ? `
              <a href="${youtubeUrl}" target="_blank"
                 class="playlist-link playlist-link--youtube"
                 title="Open in YouTube">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="me-1">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                YouTube
              </a>
            ` : ''}
          </div>
        </div>
        <div class="playlist-actions">
          <button class="btn ${buttonClass} sync-btn"
                  id="sync-btn-${id}"
                  hx-post="/api/sync/playlist/${id}"
                  hx-target="#sync-result-${id}"
                  hx-swap="innerHTML"
                  hx-indicator="#loading"
                  hx-vals='js:{batchSize: (() => {
                    const select = document.getElementById("syncBatchSize");
                    const value = select?.value || "1";
                    if (value === "all") {
                      const trackCount = document.querySelector("[data-playlist-id=\\"${id}\\"] .text-muted")?.textContent?.match(/(\\d+)\\s+tracks?/)?.[1];
                      return trackCount || "999";
                    }
                    return value;
                  })()}'
                  hx-disabled-elt=".sync-btn"
                  data-playlist-name="${escapeHtml(name)}"
                  data-playlist-id="${id}"
                  data-track-count="${tracksTotal}">
            ${buttonText}
          </button>
        </div>
      </div>

      <!-- Progress display area for real-time SSE updates -->
      <div id="progress-${id}" class="playlist-progress" style="display: none;">
        <!-- SSE progress updates will be swapped in here by sync.js -->
      </div>

      <!-- Sync result area for final summary -->
      <div id="sync-result-${id}" class="playlist-sync-result">
        <!-- Sync completion summary will be inserted here -->
      </div>

      ${isSynced ? `
        <div class="playlist-expand-area"
             data-playlist-id="${id}"
             data-expanded="false"
             hx-get="/api/playlistDetails/playlist/${id}"
             hx-target="#details-${id}"
             hx-swap="innerHTML"
             hx-trigger="click once"
             _="on click
                if @data-expanded is 'false'
                  then set @data-expanded to 'true'
                       add .expanded to me
                       show #details-${id}
                  else set @data-expanded to 'false'
                       remove .expanded from me
                       hide #details-${id}
                end">
          <span class="expand-indicator">▼</span>
        </div>
        <div class="playlist-details-container" id="details-${id}" style="display: none;">
          <div class="playlist-loading">
            <div class="loading-spinner"></div>
            Click to load playlist details...
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// Sync feedback component
export function syncFeedback(options: {
  playlistId: string;
  isUpdate: boolean;
  videosFound: number;
  totalSearched: number;
  isLimited?: boolean;
  totalTracks?: number;
  unlinkedTracks?: Array<{ track: string; artist: string }>;
}): string {
  const { playlistId, isUpdate, videosFound, totalSearched, isLimited, totalTracks, unlinkedTracks = [] } = options;
  const hasUnlinkedTracks = unlinkedTracks.length > 0;
  const multipleUnlinked = unlinkedTracks.length > 1;

  return `
    <div class="sync-feedback alert alert-success alert-dismissible fade show" data-playlist-id="${playlistId}">
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      <div><strong>Playlist ${isUpdate ? 'updated' : 'created'} successfully!</strong></div>
      <div class="small">
        Found ${videosFound} out of ${totalSearched} tracks${isLimited ? ` (limited from ${totalTracks} total)` : ''}
      </div>

      ${hasUnlinkedTracks ? `
        <div class="mt-2">
          <div class="small text-warning">
            <strong>${unlinkedTracks.length} track${multipleUnlinked ? 's' : ''} could not be linked:</strong>
          </div>
          <div class="small text-muted mt-1">
            ${unlinkedTracks.map((track, i) =>
              `${escapeHtml(track.track)} by ${escapeHtml(track.artist)}${i < unlinkedTracks.length - 1 ? ', ' : ''}`
            ).join('')}
          </div>
          <div class="small text-muted mt-1">
            <em>These tracks will appear as unlinked in the playlist details view.</em>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// Playlist list container
export function playlistListContainer(options: {
  summaryText: string;
  playlistsHtml: string;
}): string {
  const { summaryText, playlistsHtml } = options;

  return `
    <div>
      <p style="margin: 0; padding: 0;">${summaryText}</p>
      ${playlistsHtml}
    </div>
  `;
}

// Auth expired reconnect message
export function authExpiredMessage(service: 'Spotify' | 'YouTube'): string {
  const loginUrl = service === 'Spotify' ? '/auth/spotify/login' : '/auth/youtube/login';
  const color = service === 'Spotify' ? '#1DB954' : '#FF0000';

  return `
    <div style="margin: 0; padding: 0;">
      <h6>${service} session expired</h6>
      <p>Please reconnect to ${service} to continue.</p>
      <button style="background-color: ${color}; color: white; border: none; padding: 8px 16px; font-size: 16px; cursor: pointer;"
              onclick="window.location.href='${loginUrl}'">
        Reconnect to ${service}
      </button>
    </div>
  `;
}

// Connection button component
export function connectionButton(options: {
  service: 'spotify' | 'youtube';
  connected: boolean;
  loading?: boolean;
}): string {
  const { service, connected, loading = false } = options;
  const serviceCapitalized = service.charAt(0).toUpperCase() + service.slice(1);
  const buttonClass = service === 'spotify' ? 'btn-success' : 'btn-danger';
  const loginUrl = `/auth/${service}/login`;

  if (loading) {
    return `
      <button class="btn ${buttonClass} connect-btn disabled" disabled>
        <span class="d-flex align-items-center justify-content-center">
          <div class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" style="width: 0.8rem; height: 0.8rem;"></div>
          Connecting...
        </span>
      </button>
    `;
  }

  if (connected) {
    return `<button class="btn ${buttonClass} connect-btn connected" disabled>Connected</button>`;
  }

  return `
    <a href="${loginUrl}" class="btn ${buttonClass} connect-btn">
      Connect ${serviceCapitalized}
    </a>
  `;
}

// Progress update component for SSE
export function progressUpdate(options: {
  message: string;
  details?: string;
  percentage: number;
  type?: 'progress' | 'complete' | 'error';
}): string {
  const { message, details, percentage, type = 'progress' } = options;

  if (type === 'error') {
    return `
      <div class="sync-progress-container">
        <div class="d-flex align-items-center text-danger mb-2">
          <span class="progress-text">${escapeHtml(message)}</span>
        </div>
        <div class="progress mb-2" style="height: 6px;">
          <div class="progress-bar bg-danger" role="progressbar" style="width: 100%" aria-valuenow="100" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
      </div>
    `;
  }

  const progressBarClass = type === 'complete' ? 'bg-success' : 'bg-primary';
  const showSpinner = type === 'progress' && percentage < 100;

  return `
    <div class="sync-progress-container">
      <div class="d-flex align-items-center mb-2">
        ${showSpinner ? `
          <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
        ` : ''}
        <span class="progress-text">${escapeHtml(message)}</span>
        <span class="progress-percentage ms-auto text-muted">${percentage}%</span>
      </div>
      ${details ? `
        <div class="progress-details text-muted small mb-1">${escapeHtml(details)}</div>
      ` : ''}
      <div class="progress mb-2" style="height: 6px;">
        <div class="progress-bar ${progressBarClass}" role="progressbar" style="width: ${percentage}%" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100"></div>
      </div>
    </div>
  `;
}

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const htmlEscapeMap: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char]);
}
