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

    // Close the dialog when a [data-dialog-close] control (Cancel / X) is clicked.
    document.addEventListener('click', function(event) {
        const closer = event.target.closest('[data-dialog-close]');
        if (closer) {
            const dialog = closer.closest('dialog');
            if (dialog && dialog.open) {
                dialog.close();
            }
        }
    });

    // Listen for HTMX afterSwap events on the document
    document.addEventListener('htmx:afterSwap', function(event) {
        // Check if the swap target was the video modal content
        if (event.detail.target && event.detail.target.id === 'video-modal-content') {
            // Get the modal element
            const modalEl = document.getElementById('videoSelectionModal');

            if (modalEl) {
                // Open the native <dialog>
                if (typeof modalEl.showModal === 'function' && !modalEl.open) {
                    modalEl.showModal();
                }

                // Set up radio button listeners for video selection
                const radioButtons = document.querySelectorAll('.video-option-radio');
                radioButtons.forEach(radio => {
                    radio.addEventListener('change', function() {
                        const hiddenInput = document.getElementById('hidden-new-video-id');
                        const confirmBtn = document.getElementById('confirm-selection-btn');
                        if (hiddenInput && confirmBtn) {
                            hiddenInput.value = this.value;
                            confirmBtn.disabled = false;
                        }
                    });
                });
            } else {
                Logger.error('Video selection modal element not found');
            }
        }
    });

    // Listen for HTMX beforeRequest to disable button and show loading state
    document.addEventListener('htmx:beforeRequest', function(event) {
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
            // Disable the button to prevent duplicate submissions
            target.disabled = true;

            // Store original text for restoration
            const originalText = target.innerHTML;
            target.setAttribute('data-original-text', originalText);

            // Add processing state class for styling
            target.classList.add('processing-state');

            Logger.debug('Processing state applied', {
                hasClass: target.classList.contains('processing-state'),
                buttonId: target.id,
                buttonClasses: target.className
            });

            // Show loading state with spinner
            target.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing...';
        }
    });

    // Listen for HTMX afterRequest events to close modal and refresh playlist after successful video replacement
    document.addEventListener('htmx:afterRequest', function(event) {
        // Check if this is the confirm selection button
        const target = event.detail.elt;
        if (target && target.id === 'confirm-selection-btn') {
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
                // Request failed - restore button state
                target.disabled = false;
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
