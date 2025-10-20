/**
 * CSRF Security Configuration
 *
 * Initializes the CSRF secret at app startup.
 * This secret must be the same across all server instances for multi-instance deployments.
 * NEVER generate per-instance secrets - always load from environment variables.
 */

import crypto from 'crypto';
import { Logger } from '../utils/logger';

/**
 * Initialize CSRF secret
 *
 * In production: CSRF_SECRET must be set in environment variables
 * In development: Generates a random secret if not provided (for convenience)
 *
 * @returns The CSRF secret to use for token signing
 * @throws Error if CSRF_SECRET is required but not set
 */
export function initializeCsrfSecret(): string {
  const envSecret = process.env.CSRF_SECRET;

  // Production: CSRF_SECRET must be explicitly set
  if (process.env.NODE_ENV === 'production') {
    if (!envSecret) {
      throw new Error(
        'CSRF_SECRET environment variable must be set in production. ' +
        'Generate a random secret and set it before deploying: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    Logger.info('CSRF secret loaded from environment (production mode)');
    return envSecret;
  }

  // Development: Generate a random secret if not provided
  if (envSecret) {
    Logger.info('CSRF secret loaded from environment (development mode)');
    return envSecret;
  }

  // Generate a random secret for development
  const generatedSecret = crypto.randomBytes(32).toString('hex');
  Logger.warn(
    'Generated temporary CSRF secret for development. This is not persisted and will be different on each restart. ' +
    'For persistent CSRF validation (e.g., across restarts or multiple instances), set CSRF_SECRET in .env. ' +
    'Generate a secret with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
  return generatedSecret;
}

/**
 * Load CSRF secret - called at app startup
 */
export const CSRF_SECRET = initializeCsrfSecret();
