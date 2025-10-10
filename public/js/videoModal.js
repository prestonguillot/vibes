/**
 * Video Selection Modal Handler
 * Opens the Bootstrap modal when video selection content is loaded via HTMX
 */

function initializeVideoModal() {
    // Listen for HTMX afterSwap events on the document
    document.addEventListener('htmx:afterSwap', function(event) {
        // Check if the swap target was the video modal content
        if (event.detail.target && event.detail.target.id === 'video-modal-content') {
            // Get the modal element
            const modalEl = document.getElementById('videoSelectionModal');

            if (modalEl) {
                // Check if Bootstrap is available
                if (typeof bootstrap === 'undefined') {
                    Logger.error('Bootstrap is not defined - cannot open modal');
                    return;
                }

                // Create and show the modal
                const modal = new bootstrap.Modal(modalEl);
                modal.show();
            } else {
                Logger.error('Video selection modal element not found');
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
