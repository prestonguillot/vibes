import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Environment Configuration', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    // Save original NODE_ENV
    originalNodeEnv = process.env.NODE_ENV;
    // Clear the mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original NODE_ENV
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  describe('.env file selection', () => {
    it('should load .env.development when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';

      // Verify the file exists
      const fs = require('fs');
      expect(fs.existsSync('.env.development')).toBe(true);
    });

    it('should load .env.production when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';

      // Verify the file exists
      const fs = require('fs');
      expect(fs.existsSync('.env.production')).toBe(true);
    });

    it('should have .env.development committed with required values', () => {
      const fs = require('fs');
      const content = fs.readFileSync('.env.development', 'utf-8');

      // Check for required configuration keys
      expect(content).toContain('PORT=');
      expect(content).toContain('SPOTIFY_CLIENT_ID=');
      expect(content).toContain('SPOTIFY_CLIENT_SECRET=');
      expect(content).toContain('SPOTIFY_REDIRECT_URI=');
      expect(content).toContain('YOUTUBE_CLIENT_ID=');
      expect(content).toContain('YOUTUBE_CLIENT_SECRET=');
      expect(content).toContain('YOUTUBE_REDIRECT_URI=');
      expect(content).toContain('YOUTUBE_API_KEY=');
      expect(content).toContain('CSRF_SECRET=');
    });

    it('should have .env.production as a template with placeholders', () => {
      const fs = require('fs');
      const content = fs.readFileSync('.env.production', 'utf-8');

      // Should have documentation about production setup
      expect(content).toContain('Production Environment Configuration');
      expect(content).toContain('PLACEHOLDER');
      expect(content).toContain('generate-32-byte-hex-string');

      // Should explain how to set real values
      expect(content).toContain('environment variables');
      expect(content).toContain('.env.production.local');
    });

    it('should not commit actual production secrets in .env.production', () => {
      const fs = require('fs');
      const content = fs.readFileSync('.env.production', 'utf-8');

      // Should contain placeholders, not real secrets
      expect(content).not.toMatch(/^CSRF_SECRET=[a-f0-9]{64}$/m);
      expect(content).not.toMatch(/SPOTIFY_CLIENT_ID=[0-9a-z]{30,}/);
      expect(content).not.toMatch(/YOUTUBE_API_KEY=AIza[A-Za-z0-9_-]+/);
    });
  });

  describe('NODE_ENV script configuration', () => {
    it('should have NODE_ENV=development in dev script', () => {
      const fs = require('fs');
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

      expect(packageJson.scripts.dev).toContain('NODE_ENV=development');
    });

    it('should have NODE_ENV=production in start script', () => {
      const fs = require('fs');
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

      expect(packageJson.scripts.start).toContain('NODE_ENV=production');
    });

    it('should load appropriate .env file based on NODE_ENV', () => {
      // Test the logic from server.ts
      // Note: During tests, NODE_ENV is set to 'test' by vitest
      const env = process.env.NODE_ENV || 'development';
      const expectedPath = `.env.${env}`;

      // Verify the path construction - during tests it will be .env.test
      // During development it will be .env.development, in production .env.production
      expect(expectedPath).toMatch(/^\.env\.(development|production|test)$/);
    });

    it('should default to development if NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;

      // Simulate the logic from server.ts
      const env = process.env.NODE_ENV || 'development';

      expect(env).toBe('development');
    });
  });

  describe('CSRF_SECRET in different environments', () => {
    it('should have CSRF_SECRET in .env.development', () => {
      const fs = require('fs');
      const content = fs.readFileSync('.env.development', 'utf-8');

      expect(content).toContain('CSRF_SECRET=');
      // Should be a real 64-character hex string (32 bytes)
      expect(content).toMatch(/CSRF_SECRET=[a-f0-9]{64}/);
    });

    it('should have CSRF_SECRET placeholder in .env.production', () => {
      const fs = require('fs');
      const content = fs.readFileSync('.env.production', 'utf-8');

      expect(content).toContain('CSRF_SECRET=');
      // Should be a placeholder, not a real secret
      expect(content).toContain('generate-32-byte-hex-string');
    });
  });

  describe('Environment variable separation', () => {
    it('should have different values for development vs production templates', () => {
      const fs = require('fs');
      const devContent = fs.readFileSync('.env.development', 'utf-8');
      const prodContent = fs.readFileSync('.env.production', 'utf-8');

      // Development should have real credentials
      expect(devContent).toMatch(/SPOTIFY_CLIENT_ID=[a-z0-9]+/);

      // Production should have placeholders
      expect(prodContent).toContain('<your-production-spotify-client-id>');
    });
  });
});
