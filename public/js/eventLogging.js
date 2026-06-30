/**
 * Event Logging Module
 * Handles debugging and monitoring of user interactions and HTMX events
 */

// Initialize event logging when DOM is ready
function initializeEventLogging() {
  Logger.info('Event logging module initialized');

  // Add logging for button clicks
  document.addEventListener('click', function (event) {
    // Log all button clicks
    if (event.target.matches('button')) {
      Logger.userAction('Button clicked', { text: event.target.textContent?.trim() });
      Logger.debug('Button attributes', {
        id: event.target.id,
        class: event.target.className,
        type: event.target.type,
        disabled: event.target.disabled,
      });
    }
  });

  // Log basic HTMX request events
  document.addEventListener('htmx:beforeRequest', function (event) {
    Logger.htmx('Request starting', {
      method: event.detail.requestConfig.verb,
      url: event.detail.requestConfig.path,
      target: event.detail.target?.id || 'unknown',
    });
  });

  document.addEventListener('htmx:afterRequest', function (event) {
    const status = event.detail.xhr.status;
    const statusText = event.detail.xhr.statusText;
    Logger.htmx('Request completed', {
      status: `${status} ${statusText}`,
      url: event.detail.xhr.responseURL,
      responseLength: event.detail.xhr.responseText?.length || 0,
    });

    if (status >= 400) {
      Logger.error('HTMX request failed', { responseText: event.detail.xhr.responseText });
    } else {
      Logger.debug('HTMX request successful');
    }
  });

  // Handle and log HTMX errors
  document.addEventListener('htmx:responseError', function (event) {
    Logger.error('HTMX response error', event.detail);

    // If the response contains HTML error content, swap it into the target
    const xhr = event.detail.xhr;
    if (xhr && xhr.responseText && xhr.getResponseHeader('Content-Type')?.includes('text/html')) {
      const target = event.detail.target;
      if (target) {
        target.innerHTML = xhr.responseText;
      }
    }
  });

  document.addEventListener('htmx:sendError', function (event) {
    Logger.error('HTMX send error', event.detail);
  });

  // Log page navigation
  window.addEventListener('beforeunload', function (event) {
    Logger.info('Page navigation detected');
  });

  // Log any JavaScript errors
  window.addEventListener('error', function (event) {
    Logger.error(
      'JavaScript error',
      {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      },
      event.error,
    );
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeEventLogging);
} else {
  initializeEventLogging();
}

// Make initialization function available globally if needed
window.initializeEventLogging = initializeEventLogging;
