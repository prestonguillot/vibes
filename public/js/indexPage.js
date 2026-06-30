/**
 * Index page init:
 * - Shows the connection-error <dialog> for OAuth errors passed via query params.
 * - Opens YouTube video thumbnails in a new tab on click / keyboard activation.
 * The dialog closes via the shared [data-dialog-close] handler in videoModal.js.
 */
document.addEventListener('DOMContentLoaded', function () {
  const params = new URLSearchParams(window.location.search);
  const errorService = params.get('error');
  const errorReason = params.get('reason');

  if (errorService) {
    let errorMessage = 'Connection failed. Please try again.';
    const serviceDisplay = errorService.charAt(0).toUpperCase() + errorService.slice(1);

    if (errorReason === 'quota_exceeded') {
      errorMessage = `${serviceDisplay} API quota exceeded. Please wait and try again later.`;
    } else if (errorReason === 'rate_limited') {
      errorMessage = `Rate limited by ${serviceDisplay}. Please wait a moment and try again.`;
    } else if (errorReason === 'auth_error') {
      errorMessage = `${serviceDisplay} authentication failed. Please try reconnecting.`;
    } else if (errorReason === 'service_unavailable') {
      errorMessage = `${serviceDisplay} service is temporarily unavailable. Please try again soon.`;
    }

    document.getElementById('connectionErrorLabel').textContent =
      `${serviceDisplay} Connection Failed`;
    document.getElementById('connectionErrorMessage').textContent = errorMessage;
    document.getElementById('connectionErrorModal').showModal();

    // Clean up URL after showing the dialog
    window.history.replaceState({}, document.title, window.location.pathname);
  }
});

// Open clickable video thumbnails in a new tab.
document.addEventListener('click', function (e) {
  const thumbnail = e.target.closest('.youtube-video__thumbnail--clickable');
  if (thumbnail) {
    const url = thumbnail.dataset.videoUrl;
    if (url) {
      window.open(url, '_blank');
    }
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    const thumbnail = e.target.closest('.youtube-video__thumbnail--clickable');
    if (thumbnail) {
      const url = thumbnail.dataset.videoUrl;
      if (url) {
        e.preventDefault();
        window.open(url, '_blank');
      }
    }
  }
});
