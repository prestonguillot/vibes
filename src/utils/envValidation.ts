import { Logger } from './logger';

/**
 * Environment variable configuration schema
 * Defines all required and optional environment variables
 */
interface EnvSchema {
  required: {
    [key: string]: {
      description: string;
      validate?: (value: string) => boolean;
    };
  };
  optional: {
    [key: string]: {
      description: string;
      defaultValue?: string;
    };
  };
}

const envSchema: EnvSchema = {
  required: {
    // Spotify API
    SPOTIFY_CLIENT_ID: {
      description: 'Spotify API client ID',
      validate: (value) => value.length > 0
    },
    SPOTIFY_CLIENT_SECRET: {
      description: 'Spotify API client secret',
      validate: (value) => value.length > 0
    },
    SPOTIFY_REDIRECT_URI: {
      description: 'Spotify OAuth redirect URI',
      validate: (value) => value.startsWith('http')
    },

    // YouTube API
    YOUTUBE_CLIENT_ID: {
      description: 'YouTube API client ID',
      validate: (value) => value.length > 0
    },
    YOUTUBE_CLIENT_SECRET: {
      description: 'YouTube API client secret',
      validate: (value) => value.length > 0
    },
    YOUTUBE_REDIRECT_URI: {
      description: 'YouTube OAuth redirect URI',
      validate: (value) => value.startsWith('http')
    },
    YOUTUBE_API_KEY: {
      description: 'YouTube Data API key',
      validate: (value) => value.length > 0
    }
  },

  optional: {
    PORT: {
      description: 'Server port',
      defaultValue: '3000'
    },
    NODE_ENV: {
      description: 'Node environment (development/production)',
      defaultValue: 'development'
    },
    SESSION_SECRET: {
      description: 'Session encryption secret'
    },
    CSRF_SECRET: {
      description: 'CSRF token signing secret (auto-generated in development)'
    },
    ENABLE_RATE_LIMITING: {
      description: 'Enable rate limiting for sync operations (true/false)',
      defaultValue: 'false'
    }
  }
};

/**
 * Validate all environment variables at startup
 * Throws an error if any required variables are missing or invalid
 */
export function validateEnvironment(): void {
  Logger.info('Validating environment variables...');

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  for (const [key, config] of Object.entries(envSchema.required)) {
    const value = process.env[key];

    if (!value) {
      errors.push(`Missing required environment variable: ${key} (${config.description})`);
      continue;
    }

    // Run custom validation if provided
    if (config.validate && !config.validate(value)) {
      errors.push(`Invalid value for ${key}: validation failed (${config.description})`);
    }
  }

  // Check optional variables and warn about defaults
  for (const [key, config] of Object.entries(envSchema.optional)) {
    const value = process.env[key];

    if (!value) {
      if (config.defaultValue) {
        Logger.debug(`Using default for ${key}`, {
          default: config.defaultValue,
          description: config.description
        });
      } else {
        warnings.push(`Optional environment variable not set: ${key} (${config.description})`);
      }
    }
  }

  // Additional security checks
  if (process.env.NODE_ENV === 'production') {
    // In production, certain variables should not use defaults
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'your-session-secret-here-boo') {
      errors.push('SESSION_SECRET must be set to a secure random value in production');
    }

    if (!process.env.CSRF_SECRET) {
      errors.push('CSRF_SECRET must be set in production');
    }

    // Warn about localhost URLs in production
    if (process.env.SPOTIFY_REDIRECT_URI?.includes('localhost') ||
        process.env.SPOTIFY_REDIRECT_URI?.includes('127.0.0.1')) {
      warnings.push('SPOTIFY_REDIRECT_URI contains localhost - should use production domain');
    }

    if (process.env.YOUTUBE_REDIRECT_URI?.includes('localhost') ||
        process.env.YOUTUBE_REDIRECT_URI?.includes('127.0.0.1')) {
      warnings.push('YOUTUBE_REDIRECT_URI contains localhost - should use production domain');
    }
  }

  // Log warnings
  if (warnings.length > 0) {
    warnings.forEach(warning => Logger.warn('Environment variable warning', { warning }));
  }

  // If there are errors, throw and prevent server startup
  if (errors.length > 0) {
    Logger.error('Environment validation failed', {
      errorCount: errors.length,
      errors
    });
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  Logger.info('Environment validation passed ✓', {
    requiredVars: Object.keys(envSchema.required).length,
    optionalVars: Object.keys(envSchema.optional).length,
    warnings: warnings.length
  });
}

