/**
 * Video Selection Modal Handler
 * Opens the native <dialog> the moment a video-selection request starts (showing a
 * loading state), wires radio -> confirm, and closes on success / Cancel / Escape.
 */

function initializeVideoModal() {
  // The loading-state markup #video-modal-content starts with, shown while the
  // video-options request is in flight.
  const initialModalContent = document.getElementById('video-modal-content');
  const loadingMarkup = initialModalContent ? initialModalContent.innerHTML : '';

  // True while a Confirm (video replace) POST is in flight. Leaving the modal mid-write
  // abandons a request that is already changing the YouTube playlist, so every exit path
  // is sealed until it settles. The Cancel/X buttons are sealed declaratively by
  // hx-disabled-elt on the Confirm button; Escape and backdrop-click are invisible to
  // htmx and are gated on this flag instead.
  let replaceInFlight = false;

  // The video the user just picked, and the one it replaced, captured before the modal markup is
  // torn down. The old one is empty for an add: an unlinked track has nothing to replace.
  let replacedVideoId = '';
  let replacedOldVideoId = '';

  // The panel is re-read from YouTube, which is only eventually consistent: a read issued straight
  // after the write can still describe the pre-write state and paint the OLD thumbnail. Waiting a
  // fixed delay is a guess in both directions, so a read is instead checked against what the write
  // did and re-read until YouTube catches up. These are the waits BETWEEN re-reads; one more read
  // than waits happens.
  //
  // A replace is two writes, and they do not land together. The insert shows up almost at once
  // while the delete can lag seconds behind, so a read taken in between lists BOTH: the panel then
  // shows the video that was just removed as YouTube-only and calls the playlist out of sync.
  // Waiting only for the pick to arrive is waiting for half the change.
  const REFRESH_RETRY_WAITS_MS = [500, 1200, 2500];

  // A refresh reads both Spotify and YouTube, so it is slow and expensive - never assume it has
  // landed on a timer. If htmx has not swapped by now, something else is wrong; say so.
  const REFRESH_SETTLE_TIMEOUT_MS = 15000;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** The refresh control of the details panel currently rendered for a playlist, if still open. */
  function findRefreshControl(playlistId) {
    return document.querySelector(`[data-refresh-playlist="${playlistId}"]`);
  }

  /** Has the panel caught up with the pick? Rows carry their video id in the watch URL. */
  function showsVideo(playlistId, videoId) {
    const control = findRefreshControl(playlistId);
    const panel = control ? control.closest('.playlist-details') : null;
    return !!panel && !!panel.querySelector(`[data-video-url*="${videoId}"]`);
  }

  /**
   * Re-read the panel by driving its own refresh control, so the request stays defined by the
   * markup, and resolve once htmx has actually swapped the result in. Resolves false if no swap
   * arrives, rather than reporting a slow read as stale data.
   */
  function readPlaylistDetails(control) {
    const container = control.closest('.playlist-details-container');

    return new Promise((resolve) => {
      let timer;

      const settle = (swapped) => {
        clearTimeout(timer);
        document.removeEventListener('htmx:afterSwap', onSwap);
        resolve(swapped);
      };

      const onSwap = (event) => {
        if (event.detail && event.detail.target === container) {
          settle(true);
        }
      };

      timer = setTimeout(() => settle(false), REFRESH_SETTLE_TIMEOUT_MS);
      document.addEventListener('htmx:afterSwap', onSwap);
      control.click();
    });
  }

  /**
   * Re-read the panel until it shows what the write actually did - the pick present AND, for a
   * replace, the video it replaced gone - or give up loudly. Silence is what made this bug
   * invisible: the refresh was fired blind, so a missing control, a read that never landed, and a
   * stale read all looked exactly like success.
   */
  async function refreshUntilSettled(playlistId, videoId, oldVideoId) {
    for (let attempt = 0; ; attempt++) {
      const control = findRefreshControl(playlistId);
      if (!control) {
        // The panel was collapsed or replaced meanwhile - nothing to update, not a failure.
        Logger.debug('Skipping playlist refresh - details panel is not open', { playlistId });
        return;
      }

      if (!(await readPlaylistDetails(control))) {
        Logger.warn('Playlist details refresh never swapped in', {
          playlistId,
          videoId,
          attempt: attempt + 1,
          timeoutMs: REFRESH_SETTLE_TIMEOUT_MS,
        });
      }

      const arrived = showsVideo(playlistId, videoId);
      const departed = !oldVideoId || !showsVideo(playlistId, oldVideoId);

      if (arrived && departed) {
        Logger.debug('Playlist details caught up with the replacement', {
          playlistId,
          videoId,
          reads: attempt + 1,
        });
        return;
      }

      if (attempt >= REFRESH_RETRY_WAITS_MS.length) {
        Logger.error('Playlist details never caught up after replacing a video', {
          playlistId,
          videoId,
          oldVideoId,
          // Which half of the write YouTube is still hiding, so the log names the real state.
          newVideoShown: arrived,
          oldVideoStillShown: !departed,
          reads: attempt + 1,
        });
        return;
      }

      Logger.debug('Playlist details do not match the replacement yet - re-reading', {
        playlistId,
        videoId,
        newVideoShown: arrived,
        oldVideoStillShown: !departed,
        retryInMs: REFRESH_RETRY_WAITS_MS[attempt],
      });
      await wait(REFRESH_RETRY_WAITS_MS[attempt]);
    }
  }

  // Close the dialog when a [data-dialog-close] control (Cancel / X) is clicked.
  document.addEventListener('click', function (event) {
    const closer = event.target.closest('[data-dialog-close]');
    if (closer) {
      const dialog = closer.closest('dialog');
      if (dialog && dialog.open) {
        dialog.close();
      }
    }
  });

  // Click outside the modal (on the ::backdrop) dismisses it, same as the X. The dialog
  // has no padding, so its box equals the content box - a click whose target is the
  // dialog element itself landed on the backdrop, not the content.
  const dialogEl = document.getElementById('videoSelectionModal');
  if (dialogEl) {
    dialogEl.addEventListener('click', function (event) {
      if (event.target === dialogEl && !replaceInFlight) {
        dialogEl.close();
      }
    });

    // Escape reaches the dialog as a cancel event; preventing it keeps the modal open.
    dialogEl.addEventListener('cancel', function (event) {
      if (replaceInFlight) {
        event.preventDefault();
      }
    });
  }

  // Wire each video radio so selecting one arms the Confirm button.
  function wireVideoRadios() {
    document.querySelectorAll('.video-option-radio').forEach((radio) => {
      radio.addEventListener('change', function () {
        const hiddenInput = document.getElementById('hidden-new-video-id');
        const confirmBtn = document.getElementById('confirm-selection-btn');
        if (hiddenInput && confirmBtn) {
          hiddenInput.value = this.value;
          confirmBtn.disabled = false;
        }
      });
    });
  }

  // Drop any pending pick (used when a fresh search replaces the results).
  function resetVideoSelection() {
    const hiddenInput = document.getElementById('hidden-new-video-id');
    const confirmBtn = document.getElementById('confirm-selection-btn');
    if (hiddenInput) hiddenInput.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
  }

  // Re-wire the picker after either a full-modal open (#video-modal-content) or a
  // manual re-search that swaps only the results list (#video-results-list).
  document.addEventListener('htmx:afterSwap', function (event) {
    const target = event.detail.target;
    if (!target) return;

    const isFullModal = target.id === 'video-modal-content';
    const isResults = target.id === 'video-results-list';
    if (!isFullModal && !isResults) return;

    if (isFullModal) {
      const modalEl = document.getElementById('videoSelectionModal');
      if (!modalEl) {
        Logger.error('Video selection modal element not found');
        return;
      }
      if (typeof modalEl.showModal === 'function' && !modalEl.open) {
        modalEl.showModal();
      }
    }

    // A fresh search replaced the options - clear the earlier pick before re-wiring.
    if (isResults) {
      resetVideoSelection();
    }

    wireVideoRadios();
  });

  // Listen for HTMX beforeRequest to disable button and show loading state
  document.addEventListener('htmx:beforeRequest', function (event) {
    // Open the dialog as soon as the video-options request starts - showing the
    // loading state - so it launches instantly rather than after the fetch returns.
    if (event.detail.target && event.detail.target.id === 'video-modal-content') {
      event.detail.target.innerHTML = loadingMarkup;
      const modalEl = document.getElementById('videoSelectionModal');
      if (modalEl && typeof modalEl.showModal === 'function' && !modalEl.open) {
        modalEl.showModal();
      }
    }

    const target = event.detail.elt;
    if (target && target.id === 'confirm-selection-btn') {
      // Seals Escape and backdrop-click; hx-disabled-elt handles Confirm/Cancel/X.
      replaceInFlight = true;

      const picked = document.getElementById('hidden-new-video-id');
      replacedVideoId = picked ? picked.value : '';

      // The video being replaced, if any - an unlinked track is an add and has none. Captured
      // here for the same reason as the pick: the modal markup is gone by the time it is needed.
      const current = document.querySelector('#video-selection-form [name="currentVideoId"]');
      replacedOldVideoId = current ? current.value : '';

      // Store original text for restoration
      const originalText = target.innerHTML;
      target.setAttribute('data-original-text', originalText);

      // Add processing state class for styling
      target.classList.add('processing-state');

      // Show loading state with spinner
      target.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing...';
    }
  });

  // Listen for HTMX afterRequest events to close modal and refresh playlist after successful video replacement
  document.addEventListener('htmx:afterRequest', function (event) {
    // Check if this is the confirm selection button
    const target = event.detail.elt;
    if (target && target.id === 'confirm-selection-btn') {
      // The write has settled either way - exits are safe again.
      replaceInFlight = false;

      // Check if request was successful
      if (event.detail.successful) {
        // Close the native <dialog>
        const modalEl = document.getElementById('videoSelectionModal');
        if (modalEl && modalEl.open) {
          modalEl.close();
        }

        const playlistId = target.getAttribute('data-playlist-id');
        if (!playlistId) {
          Logger.error('Replaced a video but cannot refresh - the button carries no playlist id');
        } else if (!replacedVideoId) {
          Logger.error(
            'Replaced a video but cannot verify the refresh - no video id was captured',
            {
              playlistId,
            },
          );
        } else {
          refreshUntilSettled(playlistId, replacedVideoId, replacedOldVideoId).catch((error) =>
            Logger.error(
              'Failed to refresh the playlist after replacing a video',
              { playlistId },
              error,
            ),
          );
        }
      } else {
        // Request failed - restore the label so it can be retried (htmx re-enables the button).
        target.classList.remove('processing-state');

        const originalText = target.getAttribute('data-original-text');
        if (originalText) {
          target.innerHTML = originalText;
          target.removeAttribute('data-original-text');
        }
      }
    }
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeVideoModal);
} else {
  initializeVideoModal();
}

// Make initialization function available globally if needed
window.initializeVideoModal = initializeVideoModal;
