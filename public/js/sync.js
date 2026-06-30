/**
 * Sync status box behaviour. Progress and the final result stream in declaratively
 * via the htmx SSE extension (see sync-subscriber.ejs); this only handles the
 * dismiss control and moving a newly-synced playlist into place once its stream
 * closes successfully.
 */

// Dismiss a status box via its close control.
document.addEventListener('click', function (event) {
  const closeBtn = event.target.closest('.sync-status-close');
  if (!closeBtn) return;
  const box = closeBtn.closest('.sync-status-box');
  if (!box) return;
  box.classList.add('fade-out');
  setTimeout(() => {
    box.classList.remove('fade-out');
    box.classList.add('hidden');
  }, 300);
});

// When a sync stream closes (server "close" frame), reflect the outcome. Only the
// success case moves the playlist into the synced section and auto-fades; the
// nodeReplaced/nodeMissing closes (element removed) are ignored.
document.body.addEventListener('htmx:sseClose', function (event) {
  if (!event.detail || event.detail.type !== 'message') return;
  const box = event.target.closest('.sync-status-box');
  if (!box) return;

  const playlistId = box.id.replace('sync-status-', '');
  const succeeded = !!box.querySelector('[data-sync-success]');

  box.classList.remove('sync-status-working');
  box.classList.add(succeeded ? 'sync-status-success' : 'sync-status-error');

  if (succeeded) {
    movePlaylistToSyncedSection(playlistId);
    setTimeout(() => {
      box.classList.add('fade-out');
      setTimeout(() => {
        box.classList.remove('fade-out');
        box.classList.add('hidden');
      }, 300);
    }, 5000);
  }
});

// Move a newly synced playlist to its alphabetical position among synced playlists.
function movePlaylistToSyncedSection(playlistId) {
  const playlistItem = document.querySelector(`[data-playlist-id="${playlistId}"]`);
  if (!playlistItem) return;

  const playlistsContainer = document.getElementById('playlists-content');
  if (!playlistsContainer) return;

  const nameElement = playlistItem.querySelector('h5');
  if (!nameElement) return;
  const playlistName = nameElement.textContent.trim();

  const allPlaylistItems = Array.from(playlistsContainer.querySelectorAll('[data-playlist-id]'));

  let insertBeforeItem = null;
  for (let i = 0; i < allPlaylistItems.length; i++) {
    const otherItem = allPlaylistItems[i];
    if (otherItem === playlistItem) continue;
    const otherNameElement = otherItem.querySelector('h5');
    if (!otherNameElement) continue;
    if (otherNameElement.textContent.trim().localeCompare(playlistName) > 0) {
      insertBeforeItem = otherItem;
      break;
    }
  }

  if (insertBeforeItem) {
    insertBeforeItem.parentNode.insertBefore(playlistItem, insertBeforeItem);
  } else {
    playlistsContainer.appendChild(playlistItem);
  }

  playlistItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
