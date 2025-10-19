import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseSpotifyTokens, parseYouTubeTokens } from '../../src/utils/tokenParsing';
import { Logger } from '../../src/utils/logger';

// Mock the logger to prevent console output during tests
vi.mock('../../src/utils/logger', () => ({
  Logger: {
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('Token Parsing Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseSpotifyTokens', () => {
    it('should parse valid Spotify tokens', () => {
      const validTokens = {
        accessToken: 'valid_access_token_12345',
        refreshToken: 'valid_refresh_token_67890'
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseSpotifyTokens(cookieValue);

      expect(result).toEqual(validTokens);
    });

    it('should return null for undefined cookie value', () => {
      const result = parseSpotifyTokens(undefined);

      expect(result).toBeNull();
      expect(Logger.warn).not.toHaveBeenCalled();
    });

    it('should return null for empty string cookie value', () => {
      const result = parseSpotifyTokens('');

      expect(result).toBeNull();
      expect(Logger.warn).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON gracefully', () => {
      const malformedJson = '{ invalid json }';

      const result = parseSpotifyTokens(malformedJson);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalledWith(
        'Malformed Spotify token JSON in cookie',
        expect.objectContaining({
          error: expect.any(String)
        })
      );
    });

    it('should reject tokens with missing accessToken', () => {
      const invalidTokens = {
        refreshToken: 'valid_refresh_token'
      };
      const cookieValue = JSON.stringify(invalidTokens);

      const result = parseSpotifyTokens(cookieValue);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalledWith(
        'Invalid Spotify token structure in cookie',
        expect.objectContaining({
          validationErrors: expect.any(Array)
        })
      );
    });

    it('should reject tokens with missing refreshToken', () => {
      const invalidTokens = {
        accessToken: 'valid_access_token'
      };
      const cookieValue = JSON.stringify(invalidTokens);

      const result = parseSpotifyTokens(cookieValue);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalledWith(
        'Invalid Spotify token structure in cookie',
        expect.objectContaining({
          validationErrors: expect.any(Array)
        })
      );
    });

    it('should reject tokens with empty accessToken', () => {
      const invalidTokens = {
        accessToken: '',
        refreshToken: 'valid_refresh_token'
      };
      const cookieValue = JSON.stringify(invalidTokens);

      const result = parseSpotifyTokens(cookieValue);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalled();
    });

    it('should reject tokens with non-string values', () => {
      const invalidTokens = {
        accessToken: 12345,
        refreshToken: 'valid_refresh_token'
      };
      const cookieValue = JSON.stringify(invalidTokens);

      const result = parseSpotifyTokens(cookieValue);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalled();
    });

    it('should reject tokens with extra fields being ignored if core fields valid', () => {
      const tokensWithExtra = {
        accessToken: 'valid_access_token',
        refreshToken: 'valid_refresh_token',
        extraField: 'should_be_ignored',
        expiresIn: 3600
      };
      const cookieValue = JSON.stringify(tokensWithExtra);

      const result = parseSpotifyTokens(cookieValue);

      // Should only include valid fields
      expect(result).toEqual({
        accessToken: 'valid_access_token',
        refreshToken: 'valid_refresh_token'
      });
    });
  });

  describe('parseYouTubeTokens', () => {
    it('should parse valid YouTube tokens with all fields', () => {
      const validTokens = {
        access_token: 'ya29_valid_access_token',
        refresh_token: 'valid_refresh_token',
        expiry_date: 1234567890,
        token_type: 'Bearer',
        id_token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ...',
        scope: 'https://www.googleapis.com/auth/youtube'
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseYouTubeTokens(cookieValue);

      expect(result).toEqual(validTokens);
    });

    it('should parse valid YouTube tokens with minimal required fields', () => {
      const validTokens = {
        access_token: 'ya29_valid_access_token'
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseYouTubeTokens(cookieValue);

      expect(result).toEqual(validTokens);
    });

    it('should return null for undefined cookie value', () => {
      const result = parseYouTubeTokens(undefined);

      expect(result).toBeNull();
      expect(Logger.warn).not.toHaveBeenCalled();
    });

    it('should return null for empty string cookie value', () => {
      const result = parseYouTubeTokens('');

      expect(result).toBeNull();
      expect(Logger.warn).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON gracefully', () => {
      const malformedJson = '{ not valid: json: syntax }';

      const result = parseYouTubeTokens(malformedJson);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalledWith(
        'Malformed YouTube token JSON in cookie',
        expect.objectContaining({
          error: expect.any(String)
        })
      );
    });

    it('should reject tokens with missing access_token', () => {
      const invalidTokens = {
        refresh_token: 'valid_refresh_token',
        expiry_date: 1234567890
      };
      const cookieValue = JSON.stringify(invalidTokens);

      const result = parseYouTubeTokens(cookieValue);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalledWith(
        'Invalid YouTube token structure in cookie',
        expect.objectContaining({
          validationErrors: expect.any(Array)
        })
      );
    });

    it('should reject tokens with empty access_token', () => {
      const invalidTokens = {
        access_token: ''
      };
      const cookieValue = JSON.stringify(invalidTokens);

      const result = parseYouTubeTokens(cookieValue);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalled();
    });

    it('should reject tokens with non-string access_token', () => {
      const invalidTokens = {
        access_token: 12345
      };
      const cookieValue = JSON.stringify(invalidTokens);

      const result = parseYouTubeTokens(cookieValue);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalled();
    });

    it('should accept optional fields with valid types', () => {
      const validTokens = {
        access_token: 'ya29_valid_access_token',
        expiry_date: 1234567890,
        token_type: 'Bearer'
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseYouTubeTokens(cookieValue);

      expect(result).toEqual(validTokens);
    });

    it('should reject invalid optional expiry_date type', () => {
      const invalidTokens = {
        access_token: 'ya29_valid_access_token',
        expiry_date: 'not_a_number'
      };
      const cookieValue = JSON.stringify(invalidTokens);

      const result = parseYouTubeTokens(cookieValue);

      expect(result).toBeNull();
      expect(Logger.warn).toHaveBeenCalled();
    });

    it('should filter out invalid extra fields', () => {
      const tokensWithExtra = {
        access_token: 'ya29_valid_access_token',
        refresh_token: 'valid_refresh_token',
        extraField: 'should_not_appear',
        anotherExtra: 123
      };
      const cookieValue = JSON.stringify(tokensWithExtra);

      const result = parseYouTubeTokens(cookieValue);

      expect(result).toEqual({
        access_token: 'ya29_valid_access_token',
        refresh_token: 'valid_refresh_token'
      });
    });
  });

  describe('Security - Injection Prevention', () => {
    it('should not execute arbitrary code in Spotify token JSON', () => {
      const maliciousJson = '{"accessToken":"safe","refreshToken":"safe"}; console.log("hacked");';

      const result = parseSpotifyTokens(maliciousJson);

      // Should either parse safely or reject
      expect(Logger.warn).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should not execute arbitrary code in YouTube token JSON', () => {
      const maliciousJson = '{"access_token":"safe"}; process.exit(1);';

      const result = parseYouTubeTokens(maliciousJson);

      // Should either parse safely or reject
      expect(Logger.warn).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle prototype pollution attempts in Spotify tokens', () => {
      const pollutionAttempt = {
        accessToken: 'safe',
        refreshToken: 'safe',
        '__proto__': { admin: true }
      };
      const cookieValue = JSON.stringify(pollutionAttempt);

      const result = parseSpotifyTokens(cookieValue);

      expect(result).toEqual({
        accessToken: 'safe',
        refreshToken: 'safe'
      });
    });

    it('should handle very large payloads gracefully', () => {
      const largePayload = {
        accessToken: 'a'.repeat(10000),
        refreshToken: 'b'.repeat(10000)
      };
      const cookieValue = JSON.stringify(largePayload);

      const result = parseSpotifyTokens(cookieValue);

      // Should still parse without crashing
      expect(result).toEqual(largePayload);
    });
  });
});
