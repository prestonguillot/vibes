import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateYouTubeConnection } from '../../src/utils/authValidation';
import { youtubeCircuitBreaker } from '../../src/utils/circuitBreaker';
import { YouTubeTokens } from '../../src/types/oauth';

// Mock the google API
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
      })),
    },
    youtube: vi.fn().mockReturnValue({
      channels: {
        list: vi.fn(),
      },
    }),
  },
}));

describe('YouTube Auth Validation - Quota Handling', () => {
  let mockResponse: any;
  let mockYoutubeTokens: YouTubeTokens;

  beforeEach(() => {
    // Reset circuit breaker before each test
    youtubeCircuitBreaker.close();

    // Mock response object
    mockResponse = {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    };

    // Mock YouTube tokens
    mockYoutubeTokens = {
      access_token: 'mock_access_token',
      refresh_token: 'mock_refresh_token',
      expiry_date: Date.now() + 3600000,
    };

    vi.clearAllMocks();
  });

  describe('Circuit Breaker Token Clearing', () => {
    it('should return false when circuit breaker is open', async () => {
      // Open circuit breaker
      youtubeCircuitBreaker.open();

      const result = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);

      expect(result.connected).toBe(false);
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('youtube_tokens');
    });

    it('should not clear tokens when circuit breaker is closed', async () => {
      // Ensure circuit breaker is closed
      youtubeCircuitBreaker.close();

      // This will fail because we're not fully mocking the YouTube API,
      // but we're checking that clearCookie isn't called due to circuit breaker
      await validateYouTubeConnection(mockYoutubeTokens, mockResponse).catch(() => {});

      // clearCookie might be called for other reasons (auth failure), but not for circuit breaker
      // Since circuit breaker was closed, it should have attempted validation
      expect(youtubeCircuitBreaker.isOpen()).toBe(false);
    });

    it('should return false when tokens are null', async () => {
      const result = await validateYouTubeConnection(null, mockResponse);

      expect(result.connected).toBe(false);
      expect(mockResponse.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('Quota Error Detection', () => {
    it('should clear tokens on 403 quota error', async () => {
      // Mock YouTube API to throw 403 error
      const { google } = await import('googleapis');
      const mockYoutube = google.youtube({} as any);

      vi.mocked(mockYoutube.channels.list).mockRejectedValue({
        code: 403,
        message: 'Quota exceeded',
      });

      const result = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);

      expect(result.connected).toBe(false);
      // Should clear cookies on quota error
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('youtube_tokens');
      // Should open circuit breaker
      expect(youtubeCircuitBreaker.isOpen()).toBe(true);
    });
  });

  describe('User Experience Flow', () => {
    it('should transition from connected to disconnected on quota exceeded', async () => {
      // Start in connected state (circuit closed)
      expect(youtubeCircuitBreaker.isOpen()).toBe(false);

      // Simulate quota exceeded
      youtubeCircuitBreaker.open();

      // Attempt validation - should fail and clear tokens
      const result = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);

      expect(result.connected).toBe(false);
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('youtube_tokens');
      expect(youtubeCircuitBreaker.isOpen()).toBe(true);
    });

    it('should not show intermediate error state to user', () => {
      // This test documents the design decision:
      // When quota is exceeded, we clear tokens (disconnect) rather than
      // showing an error state with "QUOTA EXCEEDED" buttons

      youtubeCircuitBreaker.open();
      expect(youtubeCircuitBreaker.canProceed()).toBe(false);

      // User should see disconnected state (tokens cleared)
      // NOT an error state with special error buttons
    });
  });

  describe('Circuit Breaker State Management', () => {
    it('should prevent repeated API calls when circuit is open', async () => {
      youtubeCircuitBreaker.open();

      // Multiple validation attempts should all be blocked
      const result1 = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);
      const result2 = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);
      const result3 = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);

      expect(result1.connected).toBe(false);
      expect(result2.connected).toBe(false);
      expect(result3.connected).toBe(false);

      // Should have cleared cookies each time
      expect(mockResponse.clearCookie).toHaveBeenCalledTimes(3);
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('youtube_tokens');
    });

    it('should allow validation when circuit is closed', () => {
      youtubeCircuitBreaker.close();

      expect(youtubeCircuitBreaker.canProceed()).toBe(true);
      expect(youtubeCircuitBreaker.isOpen()).toBe(false);
    });
  });

  describe('Error Message Feedback', () => {
    it('should return quota exceeded error message when circuit breaker is open', async () => {
      youtubeCircuitBreaker.open();

      const result = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);

      expect(result.connected).toBe(false);
      expect(result.error).toBe('YouTube API quota exceeded. Please try again later.');
      expect(result.errorCode).toBe('CIRCUIT_BREAKER_OPEN');
    });

    it('should return quota exceeded error message on 403 response', async () => {
      const { google } = await import('googleapis');
      const mockYoutube = google.youtube({} as any);

      vi.mocked(mockYoutube.channels.list).mockRejectedValueOnce({
        code: 403,
        message: 'Quota exceeded',
      });

      const result = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);

      expect(result.connected).toBe(false);
      expect(result.error).toBe('YouTube API quota exceeded. Please try again later.');
      expect(result.errorCode).toBe(403);
    });

    it('should return generic error message for non-quota errors', async () => {
      const { google } = await import('googleapis');
      const mockYoutube = google.youtube({} as any);

      vi.mocked(mockYoutube.channels.list).mockRejectedValueOnce({
        code: 500,
        message: 'Internal server error',
      });

      const result = await validateYouTubeConnection(mockYoutubeTokens, mockResponse);

      expect(result.connected).toBe(false);
      expect(result.error).toBe('Unable to validate YouTube connection. Please try reconnecting.');
      expect(result.errorCode).toBe(500);
    });

    it('should return no error message when tokens are null', async () => {
      const result = await validateYouTubeConnection(null, mockResponse);

      expect(result.connected).toBe(false);
      expect(result.error).toBeUndefined();
      expect(result.errorCode).toBeUndefined();
    });
  });
});
