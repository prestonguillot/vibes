/**
 * Client-side logging utility for consistent logging across the application
 */

// Log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Current log level (can be changed for production)
let currentLogLevel = LOG_LEVELS.DEBUG;

// Helper function to format timestamp in local time as ISO 8601
function formatTimestamp() {
  const now = new Date();

  // Get local date/time components
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');

  // Calculate timezone offset
  const tzOffset = -now.getTimezoneOffset();
  const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
  const tzMinutes = String(Math.abs(tzOffset) % 60).padStart(2, '0');
  const tzSign = tzOffset >= 0 ? '+' : '-';

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${tzSign}${tzHours}:${tzMinutes}`;
}

// Helper function to format context with circular reference handling
function formatContext(context = {}) {
  if (Object.keys(context).length === 0) return '';

  try {
    // Use JSON.stringify with replacer to handle circular references
    return ` | ${JSON.stringify(context, (key, value) => {
      // Handle circular references and DOM elements
      if (value && typeof value === 'object') {
        // Skip DOM elements and other problematic objects
        if (
          value.nodeType ||
          value.constructor?.name?.includes('HTML') ||
          value.constructor?.name?.includes('Event') ||
          value.constructor?.name?.includes('Element')
        ) {
          return '[DOM Element]';
        }

        // Handle circular references by tracking seen objects
        if (formatContext._seen && formatContext._seen.has(value)) {
          return '[Circular Reference]';
        }

        if (!formatContext._seen) {
          formatContext._seen = new WeakSet();
        }
        formatContext._seen.add(value);
      }

      return value;
    })}`;
  } catch (error) {
    // Fallback for any remaining serialization issues
    return ` | [Object - could not serialize: ${error.message}]`;
  } finally {
    // Clean up the tracking set
    delete formatContext._seen;
  }
}

// Emoji mappings for different log types and operations
const EMOJIS = {
  // General log levels
  DEBUG: '🔍',
  INFO: 'ℹ️',
  WARN: '⚠️',
  ERROR: '❌',

  // Operation types
  USER: '👤',
  CACHE: '💾',
  SYNC: '🔄',
  PLAYLIST: '📋',
  VIDEO: '🎬',
  SEARCH: '🔍',
  SUCCESS: '✅',
  CONNECTION: '🔗',
  AUTH: '🔐',
  EVENT: '🎯',
  HTMX: '🌐',
  MODAL: '📱',
  BUTTON: '🔘',
  EDIT: '✏️',
  REFRESH: '🔄',
};

// Helper function to get appropriate emoji based on message content and context
function getContextualEmoji(message, context = {}, level) {
  const msg = message.toLowerCase();

  // Check for specific operation types in message
  if (msg.includes('user') || msg.includes('click') || msg.includes('action')) return EMOJIS.USER;
  if (
    msg.includes('cache') ||
    msg.includes('storage') ||
    msg.includes('save') ||
    msg.includes('load')
  )
    return EMOJIS.CACHE;
  if (msg.includes('sync') || msg.includes('refresh')) return EMOJIS.SYNC;
  if (msg.includes('playlist')) return EMOJIS.PLAYLIST;
  if (msg.includes('video') || msg.includes('track')) return EMOJIS.VIDEO;
  if (msg.includes('search') || msg.includes('found')) return EMOJIS.SEARCH;
  if (msg.includes('success') || msg.includes('completed') || msg.includes('validated'))
    return EMOJIS.SUCCESS;
  if (msg.includes('connection') || msg.includes('status')) return EMOJIS.CONNECTION;
  if (msg.includes('auth') || msg.includes('token') || msg.includes('login')) return EMOJIS.AUTH;
  if (msg.includes('event') || msg.includes('listener')) return EMOJIS.EVENT;
  if (msg.includes('htmx') || msg.includes('request') || msg.includes('response'))
    return EMOJIS.HTMX;
  if (msg.includes('modal') || msg.includes('dialog')) return EMOJIS.MODAL;
  if (msg.includes('button') || msg.includes('btn')) return EMOJIS.BUTTON;
  if (msg.includes('edit') || msg.includes('replace')) return EMOJIS.EDIT;

  // Check context for hints
  if (context.playlistId || context.playlistName) return EMOJIS.PLAYLIST;
  if (context.videoId || context.trackId) return EMOJIS.VIDEO;
  if (context.cached !== undefined) return EMOJIS.CACHE;
  if (context.buttonId || context.element) return EMOJIS.BUTTON;

  // Fall back to log level emoji
  switch (level) {
    case LOG_LEVELS.DEBUG:
      return EMOJIS.DEBUG;
    case LOG_LEVELS.INFO:
      return EMOJIS.INFO;
    case LOG_LEVELS.WARN:
      return EMOJIS.WARN;
    case LOG_LEVELS.ERROR:
      return EMOJIS.ERROR;
    default:
      return EMOJIS.INFO;
  }
}

// Core logging function
function log(level, message, context = {}, error = null) {
  if (level < currentLogLevel) return;

  const timestamp = formatTimestamp();
  const contextStr = formatContext(context);
  const levelStr = Object.keys(LOG_LEVELS)[level];
  const emoji = getContextualEmoji(message, context, level);

  const logMessage = `${emoji} [${timestamp}] [${levelStr}] ${message}${contextStr}`;

  switch (level) {
    case LOG_LEVELS.DEBUG:
      console.debug(logMessage);
      break;
    case LOG_LEVELS.INFO:
      console.log(logMessage);
      break;
    case LOG_LEVELS.WARN:
      console.warn(logMessage);
      if (error) console.warn('❌ Error details:', error);
      break;
    case LOG_LEVELS.ERROR:
      console.error(logMessage);
      if (error) console.error('❌ Error details:', error);
      break;
  }
}

// Public API
const Logger = {
  // Set log level
  setLevel: (level) => {
    currentLogLevel = level;
  },

  // Debug logging (detailed information for debugging)
  debug: (message, context = {}) => {
    log(LOG_LEVELS.DEBUG, message, context);
  },

  // Info logging (general information)
  info: (message, context = {}) => {
    log(LOG_LEVELS.INFO, message, context);
  },

  // Warning logging (something unexpected but not critical)
  warn: (message, context = {}, error = null) => {
    log(LOG_LEVELS.WARN, message, context, error);
  },

  // Error logging (critical errors)
  error: (message, context = {}, error = null) => {
    log(LOG_LEVELS.ERROR, message, context, error);
  },

  // Specialized logging methods for common patterns

  // API request logging
  apiRequest: (method, url, context = {}) => {
    log(LOG_LEVELS.INFO, `API Request: ${method} ${url}`, context);
  },

  // API response logging
  apiResponse: (method, url, status, context = {}) => {
    const level = status >= 400 ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO;
    log(level, `API Response: ${method} ${url} - ${status}`, context);
  },

  // User action logging
  userAction: (action, context = {}) => {
    log(LOG_LEVELS.INFO, `User Action: ${action}`, context);
  },

  // Authentication logging
  auth: (service, status, context = {}) => {
    log(LOG_LEVELS.INFO, `Auth: ${service} - ${status}`, context);
  },

  // Cache operations
  cache: (operation, key, context = {}) => {
    log(LOG_LEVELS.DEBUG, `Cache: ${operation} - ${key}`, context);
  },

  // Performance logging
  performance: (operation, duration, context = {}) => {
    log(LOG_LEVELS.INFO, `Performance: ${operation} completed in ${duration}ms`, context);
  },

  // HTMX event logging
  htmx: (event, details = {}) => {
    log(LOG_LEVELS.DEBUG, `HTMX: ${event}`, details);
  },
};

// Make Logger available globally
window.Logger = Logger;

// Initialize logging
Logger.info('Client-side logger initialized');
