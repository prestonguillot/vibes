/**
 * Clicking a [data-alert-dismiss] control removes its closest .alert.
 */
document.addEventListener('click', function (event) {
  const dismisser = event.target.closest('[data-alert-dismiss]');
  if (dismisser) {
    const alert = dismisser.closest('.alert');
    if (alert) {
      alert.remove();
    }
  }
});
