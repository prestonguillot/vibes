/**
 * Server-side logging utility for consistent logging across the application
 */

// Log levels
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4, // suppresses all output (LOG_LEVEL=silent, or used by the test setup)
}

/**
 * Parse the log level from LOG_LEVEL, falling back to a per-environment default.
 *
 * Exported for tests. The `typeof === 'number'` check is load-bearing: a numeric enum carries
 * REVERSE mappings, so `'0' in LogLevel` is true and `LogLevel['0']` is the string 'DEBUG'. Taking
 * that as the level left currentLogLevel holding a string, which made `level < currentLogLevel`
 * always false - so LOG_LEVEL=0 silently logged everything at every level.
 */
export function getInitialLogLevel(): LogLevel {
  const logLevelEnv = process.env.LOG_LEVEL?.toUpperCase();

  if (logLevelEnv) {
    const parsed = LogLevel[logLevelEnv as keyof typeof LogLevel];
    if (typeof parsed === 'number') return parsed;
  }

  // Default: DEBUG in development, INFO in production
  return process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
}

// Current log level (can be changed at runtime via setLevel())
let currentLogLevel = getInitialLogLevel();

// Helper function to format timestamp in local time as ISO 8601
function formatTimestamp(): string {
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

// Sensitive keys that should be redacted from logs
const SENSITIVE_KEYS = [
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'password',
  'secret',
  'apiKey',
  'api_key',
  'token',
  'tokens',
  'credentials',
  'authorization',
  'cookie',
  'cookies',
];

/** Redact anything whose key looks sensitive. Exported for tests - this is the security-relevant
 *  half of the logger, and nothing exercised it. */
export function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();

    // Check if key contains any sensitive keywords
    const isSensitive = SENSITIVE_KEYS.some((sensitiveKey) =>
      lowerKey.includes(sensitiveKey.toLowerCase()),
    );

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeContext(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// Helper function to format context
function formatContext(context: Record<string, unknown> = {}): string {
  if (Object.keys(context).length === 0) return '';
  const sanitized = sanitizeContext(context);
  return ` | ${JSON.stringify(sanitized)}`;
}

// Emoji mappings for different log types and operations
const EMOJIS = {
  // General log levels
  DEBUG: '🔍',
  INFO: 'ℹ️',
  WARN: '⚠️',
  ERROR: '❌',

  // Operation types
  SERVER: '🚀',
  AUTH: '🔐',
  EXTERNAL: '🌐',
  REQUEST: '📝',
  SUCCESS: '✅',
  REFRESH: '🔄',
  MUSIC: '🎵',
  PLAYLIST: '📋',
  VIDEO: '🎬',
  SEARCH: '🔍',
  SYNC: '🔄',
  CACHE: '💾',
  USER: '👤',
  API: '📊',
  PERFORMANCE: '⚡',
  SESSION: '🎫',
  HTTP: '🌐',
};

// Helper function to get appropriate emoji based on message content and context
function getContextualEmoji(
  message: string,
  context: Record<string, unknown> = {},
  level: LogLevel,
): string {
  const msg = message.toLowerCase();

  // Check for specific operation types in message
  if (msg.includes('server') || msg.includes('started') || msg.includes('running'))
    return EMOJIS.SERVER;
  if (msg.includes('auth') || msg.includes('token') || msg.includes('login')) return EMOJIS.AUTH;
  if (msg.includes('spotify') || msg.includes('youtube') || msg.includes('external'))
    return EMOJIS.EXTERNAL;
  if (msg.includes('sync') || msg.includes('refresh')) return EMOJIS.SYNC;
  if (msg.includes('playlist')) return EMOJIS.PLAYLIST;
  if (msg.includes('video') || msg.includes('track')) return EMOJIS.VIDEO;
  if (msg.includes('search') || msg.includes('found')) return EMOJIS.SEARCH;
  if (msg.includes('cache') || msg.includes('storage')) return EMOJIS.CACHE;
  if (msg.includes('performance') || msg.includes('completed in') || msg.includes('ms'))
    return EMOJIS.PERFORMANCE;
  if (msg.includes('session')) return EMOJIS.SESSION;
  if (msg.includes('http') || msg.includes('request') || msg.includes('response'))
    return EMOJIS.HTTP;
  if (msg.includes('api') || msg.includes('quota')) return EMOJIS.API;
  if (msg.includes('success') || msg.includes('validated') || msg.includes('created'))
    return EMOJIS.SUCCESS;

  // Check context for hints
  if (context.sessionId || context.sessionID) return EMOJIS.SESSION;
  if (context.playlistId || context.playlistName) return EMOJIS.PLAYLIST;
  if (context.videoId || context.trackId) return EMOJIS.VIDEO;
  if (context.quotaUsed || context.apiCalls) return EMOJIS.API;

  // Fall back to log level emoji
  switch (level) {
    case LogLevel.DEBUG:
      return EMOJIS.DEBUG;
    case LogLevel.INFO:
      return EMOJIS.INFO;
    case LogLevel.WARN:
      return EMOJIS.WARN;
    case LogLevel.ERROR:
      return EMOJIS.ERROR;
    default:
      return EMOJIS.INFO;
  }
}

// Core logging function
function log(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> = {},
  error?: unknown,
): void {
  if (level < currentLogLevel) return;

  const timestamp = formatTimestamp();
  const contextStr = formatContext(context);
  const levelStr = LogLevel[level];
  const emoji = getContextualEmoji(message, context, level);

  const logMessage = `${emoji} [${timestamp}] [${levelStr}] ${message}${contextStr}`;

  switch (level) {
    case LogLevel.DEBUG:
      console.debug(logMessage);
      break;
    case LogLevel.INFO:
      console.log(logMessage);
      break;
    case LogLevel.WARN:
      console.warn(logMessage);
      if (error) console.warn('❌ Error details:', error);
      break;
    case LogLevel.ERROR:
      console.error(logMessage);
      if (error) console.error('❌ Error details:', error);
      break;
  }
}

// Public API
export const Logger = {
  // Set log level
  setLevel: (level: LogLevel) => {
    currentLogLevel = level;
  },

  // Debug logging (detailed information for debugging)
  debug: (message: string, context: Record<string, unknown> = {}) => {
    log(LogLevel.DEBUG, message, context);
  },

  // Info logging (general information)
  info: (message: string, context: Record<string, unknown> = {}) => {
    log(LogLevel.INFO, message, context);
  },

  // Warning logging (something unexpected but not critical)
  warn: (message: string, context: Record<string, unknown> = {}, error?: unknown) => {
    log(LogLevel.WARN, message, context, error);
  },

  // Error logging (critical errors)
  error: (message: string, context: Record<string, unknown> = {}, error?: unknown) => {
    log(LogLevel.ERROR, message, context, error);
  },

  // Specialized logging methods for common patterns

  // HTTP request logging
  httpRequest: (method: string, path: string, context: Record<string, unknown> = {}) => {
    log(LogLevel.INFO, `HTTP Request: ${method} ${path}`, context);
  },

  // HTTP response logging
  httpResponse: (
    method: string,
    path: string,
    status: number,
    duration?: number,
    context: Record<string, unknown> = {},
  ) => {
    const level = status >= 400 ? LogLevel.ERROR : LogLevel.INFO;
    const durationStr = duration ? ` (${duration}ms)` : '';
    log(level, `HTTP Response: ${method} ${path} - ${status}${durationStr}`, context);
  },

  // API operation logging
  apiOperation: (operation: string, context: Record<string, unknown> = {}) => {
    log(LogLevel.INFO, `API Operation: ${operation}`, context);
  },

  // Authentication logging
  auth: (service: string, status: string, context: Record<string, unknown> = {}) => {
    log(LogLevel.INFO, `Auth: ${service} - ${status}`, context);
  },

  // Database/external service logging
  external: (service: string, operation: string, context: Record<string, unknown> = {}) => {
    log(LogLevel.DEBUG, `External: ${service} - ${operation}`, context);
  },

  // Performance logging
  performance: (operation: string, duration: number, context: Record<string, unknown> = {}) => {
    log(LogLevel.INFO, `Performance: ${operation} completed in ${duration}ms`, context);
  },

  // Session logging
  session: (action: string, sessionId: string, context: Record<string, unknown> = {}) => {
    log(LogLevel.DEBUG, `Session: ${action}`, { sessionId, ...context });
  },

  // Request block logging (for major operations)
  requestStart: (operation: string, context: Record<string, unknown> = {}) => {
    log(LogLevel.INFO, `=== ${operation.toUpperCase()} START ===`, context);
  },

  requestEnd: (operation: string, duration: number, context: Record<string, unknown> = {}) => {
    log(LogLevel.INFO, `=== ${operation.toUpperCase()} END (${duration}ms) ===`, context);
  },
};

// Initialize logging
Logger.info('Server-side logger initialized');
