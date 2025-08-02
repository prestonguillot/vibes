/**
 * Event Logging Module
 * Handles debugging and monitoring of user interactions and HTMX events
 */

// Initialize event logging when DOM is ready
function initializeEventLogging() {
    console.log('Event logging initialized at:', new Date().toISOString());

    // Add logging for button clicks
    document.addEventListener('click', function(event) {
        // Log all button clicks
        if (event.target.matches('button')) {
            console.log(`Button clicked: "${event.target.textContent?.trim()}"`);
            console.log(`Button attributes:`, {
                id: event.target.id,
                class: event.target.className,
                type: event.target.type,
                disabled: event.target.disabled
            });
        }
    });

    // Log basic HTMX request events
    document.addEventListener('htmx:beforeRequest', function(event) {
        console.log('HTMX request starting:', {
            method: event.detail.requestConfig.verb,
            url: event.detail.requestConfig.path,
            target: event.detail.target,
            timestamp: new Date().toISOString()
        });
    });

    document.addEventListener('htmx:afterRequest', function(event) {
        const status = event.detail.xhr.status;
        const statusText = event.detail.xhr.statusText;
        console.log(`HTMX request completed:`, {
            status: `${status} ${statusText}`,
            url: event.detail.xhr.responseURL,
            responseLength: event.detail.xhr.responseText?.length || 0,
            timestamp: new Date().toISOString()
        });

        if (status >= 400) {
            console.error('HTMX request failed:', event.detail.xhr.responseText);
        } else {
            console.log('HTMX request successful');
        }
    });

    // Log HTMX errors
    document.addEventListener('htmx:responseError', function(event) {
        console.error('HTMX response error:', event.detail);
    });

    document.addEventListener('htmx:sendError', function(event) {
        console.error('HTMX send error:', event.detail);
    });

    // Log page navigation
    window.addEventListener('beforeunload', function(event) {
        console.log('Page navigation detected');
    });

    // Log any JavaScript errors
    window.addEventListener('error', function(event) {
        console.error('JavaScript error:', {
            message: event.message,
            filename: event.filename,
            line: event.lineno,
            column: event.colno,
            error: event.error
        });
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
