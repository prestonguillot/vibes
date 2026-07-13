/**
 * Centralized error formatting utility
 * Ensures consistent error message handling across all route handlers
 * Respects NODE_ENV to prevent information disclosure in production
 */

/**
 * Format error details for user-facing responses
 * In development: shows full error message for debugging
 * In production: shows generic message to prevent information disclosure
 *
 * @param error - The error to format
 * @returns Formatted error message appropriate for NODE_ENV
 */
export function formatErrorDetails(error: unknown): string {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (isDevelopment) {
    // Development: show full error details for debugging
    return error instanceof Error ? error.message : 'Unknown error';
  } else {
    // Production: show generic message to prevent information disclosure
    return 'An error occurred. Please try again or contact support.';
  }
}

/** Renders a Retry-After delay (seconds) as a short human phrase, e.g. "2 hours" or "45 seconds". */
export function formatRetryAfter(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  const unit = (n: number, label: string) => `${n} ${label}${n === 1 ? '' : 's'}`;
  if (rounded < 60) return unit(rounded, 'second');
  if (rounded < 3600) return unit(Math.round(rounded / 60), 'minute');
  return unit(Math.round(rounded / 3600), 'hour');
}
