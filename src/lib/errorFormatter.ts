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
