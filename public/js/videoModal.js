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

        // Refresh the playlist details after a short delay
        setTimeout(() => {
          const playlistId = target.getAttribute('data-playlist-id');
          if (playlistId) {
            const refreshBtn = document.querySelector(`[data-refresh-playlist="${playlistId}"]`);
            if (refreshBtn) {
              refreshBtn.click();
            }
          }
        }, 300);
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
