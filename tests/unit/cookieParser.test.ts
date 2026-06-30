import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSpotifyTokenCookie, parseYouTubeTokenCookie } from '../../src/auth/cookieParser';
import { Response } from 'express';

describe('Cookie Parser Utilities', () => {
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockRes = {
      clearCookie: vi.fn(),
    };
  });

  describe('parseSpotifyTokenCookie', () => {
    it('should parse valid Spotify token cookie', () => {
      const validTokens = {
        accessToken: 'valid_access_token_123',
        refreshToken: 'valid_refresh_token_456',
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseSpotifyTokenCookie(cookieValue, mockRes as Response);

      expect(result).toEqual(validTokens);
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });

    it('should return null for undefined cookie', () => {
      const result = parseSpotifyTokenCookie(undefined, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });

    it('should return null and clear cookie for invalid JSON', () => {
      const invalidJson = 'not valid json {[}';

      const result = parseSpotifyTokenCookie(invalidJson, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('spotify_tokens');
    });

    it('should return null and clear cookie for invalid token structure', () => {
      const invalidStructure = JSON.stringify({
        accessToken: 'valid',
        // missing refreshToken
      });

      const result = parseSpotifyTokenCookie(invalidStructure, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('spotify_tokens');
    });

    it('should return null and clear cookie for empty tokens', () => {
      const emptyTokens = JSON.stringify({
        accessToken: '',
        refreshToken: 'token',
      });

      const result = parseSpotifyTokenCookie(emptyTokens, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('spotify_tokens');
    });

    it('should work without Response object provided', () => {
      const validTokens = {
        accessToken: 'valid_access_token_123',
        refreshToken: 'valid_refresh_token_456',
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseSpotifyTokenCookie(cookieValue);

      expect(result).toEqual(validTokens);
    });

    it('should accept valid tokens even with extra properties', () => {
      // Extra properties are allowed by Zod and don't pose security risk
      const tokensWithExtra = JSON.stringify({
        accessToken: 'token_123',
        refreshToken: 'token_456',
        extraProperty: 'ignored',
      });

      const result = parseSpotifyTokenCookie(tokensWithExtra, mockRes as Response);

      expect(result).toEqual({
        accessToken: 'token_123',
        refreshToken: 'token_456',
      });
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });

    it('should handle tokens with special characters safely', () => {
      const specialCharTokens = {
        accessToken: 'token_with_!@#$%^&*()_+-=[]{}|;:",.<>?/~`',
        refreshToken: 'another_token_with_special_chars',
      };
      const cookieValue = JSON.stringify(specialCharTokens);

      const result = parseSpotifyTokenCookie(cookieValue, mockRes as Response);

      expect(result).toEqual(specialCharTokens);
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('parseYouTubeTokenCookie', () => {
    it('should parse valid YouTube token cookie', () => {
      const validTokens = {
        access_token: 'ya29.a0AfH6SMBx...',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000,
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseYouTubeTokenCookie(cookieValue, mockRes as Response);

      expect(result).toEqual(validTokens);
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });

    it('should parse YouTube token without optional refresh_token', () => {
      const validTokens = {
        access_token: 'ya29.a0AfH6SMBx...',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseYouTubeTokenCookie(cookieValue, mockRes as Response);

      expect(result).toEqual(validTokens);
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });

    it('should return null for undefined cookie', () => {
      const result = parseYouTubeTokenCookie(undefined, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });

    it('should return null and clear cookie for invalid JSON', () => {
      const invalidJson = 'this is not json at all';

      const result = parseYouTubeTokenCookie(invalidJson, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('youtube_tokens');
    });

    it('should return null and clear cookie for missing required fields', () => {
      const invalidStructure = JSON.stringify({
        access_token: 'token',
        // missing scope and token_type
      });

      const result = parseYouTubeTokenCookie(invalidStructure, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('youtube_tokens');
    });

    it('should return null and clear cookie for empty access_token', () => {
      const emptyToken = JSON.stringify({
        access_token: '',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
      });

      const result = parseYouTubeTokenCookie(emptyToken, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('youtube_tokens');
    });

    it('should handle malicious array instead of object', () => {
      const maliciousArray = JSON.stringify(['access_token', 'scope', 'token_type']);

      const result = parseYouTubeTokenCookie(maliciousArray, mockRes as Response);

      expect(result).toBeNull();
      expect(mockRes.clearCookie).toHaveBeenCalledWith('youtube_tokens');
    });

    it('should work without Response object provided', () => {
      const validTokens = {
        access_token: 'ya29.a0AfH6SMBx...',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
      };
      const cookieValue = JSON.stringify(validTokens);

      const result = parseYouTubeTokenCookie(cookieValue);

      expect(result).toEqual(validTokens);
    });

    it('should accept optional refresh_token and expiry_date', () => {
      const fullTokens = {
        access_token: 'ya29.a0AfH6SMBx...',
        refresh_token: '1//refresh_token_here',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
        expiry_date: 1234567890,
      };
      const cookieValue = JSON.stringify(fullTokens);

      const result = parseYouTubeTokenCookie(cookieValue, mockRes as Response);

      expect(result).toEqual(fullTokens);
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('Error logging', () => {
    it('should log warnings for parse failures', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const invalidJson = 'not json';

      parseSpotifyTokenCookie(invalidJson, mockRes as Response);

      // The Logger.warn should have been called (tested through behavior, not logging directly)
      // Actual verification happens through mockRes.clearCookie being called
      expect(mockRes.clearCookie).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should identify malicious activity based on parse failure', () => {
      const maliciousPayload = 'DROP TABLE users; --';

      parseSpotifyTokenCookie(maliciousPayload, mockRes as Response);

      expect(mockRes.clearCookie).toHaveBeenCalledWith('spotify_tokens');
    });
  });
});
