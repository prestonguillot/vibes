/**
 * Unit tests for OAuth token parsing
 */

import { describe, it, expect } from 'vitest';
import { parseSpotifyTokens, parseYouTubeTokens, SpotifyTokens, YouTubeTokens } from '@/types/oauth';

describe('OAuth Token Parsing', () => {
  describe('parseSpotifyTokens', () => {
    it('should return null for undefined input', () => {
      expect(parseSpotifyTokens(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseSpotifyTokens('')).toBeNull();
    });

    it('should parse valid Spotify tokens', () => {
      const validTokens: SpotifyTokens = {
        accessToken: 'BQD4odFghC9A...',
        refreshToken: 'AQD_H0PzC...'
      };

      const result = parseSpotifyTokens(JSON.stringify(validTokens));

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe(validTokens.accessToken);
      expect(result?.refreshToken).toBe(validTokens.refreshToken);
    });

    it('should return null for malformed JSON', () => {
      expect(parseSpotifyTokens('not valid json')).toBeNull();
      expect(parseSpotifyTokens('{"incomplete":')).toBeNull();
      expect(parseSpotifyTokens('{accessToken: "missing quotes"}')).toBeNull();
    });

    it('should return null when accessToken is missing', () => {
      const invalidTokens = JSON.stringify({
        refreshToken: 'AQD_H0PzC...'
      });

      expect(parseSpotifyTokens(invalidTokens)).toBeNull();
    });

    it('should return null when refreshToken is missing', () => {
      const invalidTokens = JSON.stringify({
        accessToken: 'BQD4odFghC9A...'
      });

      expect(parseSpotifyTokens(invalidTokens)).toBeNull();
    });

    it('should return null when accessToken is not a string', () => {
      const invalidTokens = JSON.stringify({
        accessToken: 123,
        refreshToken: 'AQD_H0PzC...'
      });

      expect(parseSpotifyTokens(invalidTokens)).toBeNull();
    });

    it('should return null when refreshToken is not a string', () => {
      const invalidTokens = JSON.stringify({
        accessToken: 'BQD4odFghC9A...',
        refreshToken: null
      });

      expect(parseSpotifyTokens(invalidTokens)).toBeNull();
    });

    it('should ignore extra fields in valid tokens', () => {
      const tokensWithExtra = JSON.stringify({
        accessToken: 'BQD4odFghC9A...',
        refreshToken: 'AQD_H0PzC...',
        extraField: 'should be ignored',
        anotherField: 123
      });

      const result = parseSpotifyTokens(tokensWithExtra);

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('BQD4odFghC9A...');
      expect(result?.refreshToken).toBe('AQD_H0PzC...');
    });
  });

  describe('parseYouTubeTokens', () => {
    it('should return null for undefined input', () => {
      expect(parseYouTubeTokens(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseYouTubeTokens('')).toBeNull();
    });

    it('should parse valid YouTube tokens with all fields', () => {
      const validTokens: YouTubeTokens = {
        access_token: 'ya29.a0AfH6SM...',
        refresh_token: '1//0gL3Z...',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
        expiry_date: 1234567890
      };

      const result = parseYouTubeTokens(JSON.stringify(validTokens));

      expect(result).not.toBeNull();
      expect(result?.access_token).toBe(validTokens.access_token);
      expect(result?.refresh_token).toBe(validTokens.refresh_token);
      expect(result?.scope).toBe(validTokens.scope);
      expect(result?.token_type).toBe(validTokens.token_type);
      expect(result?.expiry_date).toBe(validTokens.expiry_date);
    });

    it('should parse valid YouTube tokens with only required fields', () => {
      const minimalTokens = {
        access_token: 'ya29.a0AfH6SM...',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer'
      };

      const result = parseYouTubeTokens(JSON.stringify(minimalTokens));

      expect(result).not.toBeNull();
      expect(result?.access_token).toBe(minimalTokens.access_token);
      expect(result?.scope).toBe(minimalTokens.scope);
      expect(result?.token_type).toBe(minimalTokens.token_type);
      expect(result?.refresh_token).toBeUndefined();
      expect(result?.expiry_date).toBeUndefined();
    });

    it('should return null for malformed JSON', () => {
      expect(parseYouTubeTokens('not valid json')).toBeNull();
      expect(parseYouTubeTokens('{"incomplete":')).toBeNull();
      expect(parseYouTubeTokens('{access_token: "missing quotes"}')).toBeNull();
    });

    it('should return null when access_token is missing', () => {
      const invalidTokens = JSON.stringify({
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer'
      });

      expect(parseYouTubeTokens(invalidTokens)).toBeNull();
    });

    it('should return null when token_type is missing', () => {
      const invalidTokens = JSON.stringify({
        access_token: 'ya29.a0AfH6SM...',
        scope: 'https://www.googleapis.com/auth/youtube'
      });

      expect(parseYouTubeTokens(invalidTokens)).toBeNull();
    });

    it('should return null when access_token is not a string', () => {
      const invalidTokens = JSON.stringify({
        access_token: 123,
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer'
      });

      expect(parseYouTubeTokens(invalidTokens)).toBeNull();
    });

    it('should return null when token_type is not a string', () => {
      const invalidTokens = JSON.stringify({
        access_token: 'ya29.a0AfH6SM...',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: null
      });

      expect(parseYouTubeTokens(invalidTokens)).toBeNull();
    });

    it('should ignore extra fields in valid tokens', () => {
      const tokensWithExtra = JSON.stringify({
        access_token: 'ya29.a0AfH6SM...',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer',
        extraField: 'should be ignored',
        anotherField: 123
      });

      const result = parseYouTubeTokens(tokensWithExtra);

      expect(result).not.toBeNull();
      expect(result?.access_token).toBe('ya29.a0AfH6SM...');
      expect(result?.token_type).toBe('Bearer');
    });

    it('should handle tokens with scope field present', () => {
      // Note: scope is in the interface but not validated in the parser
      // This test documents current behavior
      const tokensWithScope = JSON.stringify({
        access_token: 'ya29.a0AfH6SM...',
        scope: 'https://www.googleapis.com/auth/youtube',
        token_type: 'Bearer'
      });

      const result = parseYouTubeTokens(tokensWithScope);

      expect(result).not.toBeNull();
      expect(result?.scope).toBe('https://www.googleapis.com/auth/youtube');
    });
  });
});
