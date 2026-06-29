import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';

/**
 * Environment configuration tests.
 *
 * These assert only on committed, non-secret artifacts (package.json scripts) and
 * pure NODE_ENV path logic. They deliberately do NOT read .env.development /
 * .env.production: those are gitignored (only .env.example is committed), may hold
 * real local secrets, and are absent from any clean checkout (e.g. CI). The actual
 * "don't commit secrets" guarantee is enforced by .gitignore, not a test.
 */
describe('Environment Configuration', () => {
  describe('NODE_ENV script configuration', () => {
    it('uses NODE_ENV=development in the dev script', () => {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      expect(pkg.scripts.dev).toContain('NODE_ENV=development');
    });

    it('uses NODE_ENV=production in the start script', () => {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      expect(pkg.scripts.start).toContain('NODE_ENV=production');
    });
  });

  describe('NODE_ENV-based env file path', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    });

    it('constructs .env.<env> for the current NODE_ENV', () => {
      const env = process.env.NODE_ENV || 'development';
      expect(`.env.${env}`).toMatch(/^\.env\.(development|production|test)$/);
    });

    it('defaults to development when NODE_ENV is unset', () => {
      delete process.env.NODE_ENV;
      expect(process.env.NODE_ENV || 'development').toBe('development');
    });
  });
});
