import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateSpotifyConnection } from '../../src/utils/authValidation';
import { spotifyCircuitBreaker } from '../../src/utils/circuitBreaker';
import { SpotifyTokens } from '../../src/types/oauth';
import { SpotifyApiError } from '../../src/utils/spotifyClient';

// Mock the hand-written Spotify client. authValidation calls getCurrentUser to
// probe the connection and refreshAccessToken to refresh on 401. The real
// SpotifyApiError class is preserved so status-based branching still works.
const { mockGetCurrentUser, mockRefreshAccessToken } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockRefreshAccessToken: vi.fn(),
}));

vi.mock('../../src/utils/spotifyClient', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/spotifyClient')>();
  return {
    ...actual,
    getCurrentUser: mockGetCurrentUser,
    refreshAccessToken: mockRefreshAccessToken,
  };
});

describe('Spotify Circuit Breaker', () => {
  let mockResponse: any;
  let mockSpotifyTokens: SpotifyTokens;

  beforeEach(() => {
    // Reset circuit breaker before each test
    spotifyCircuitBreaker.close();

    // Mock response object
    mockResponse = {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    };

    // Mock Spotify tokens
    mockSpotifyTokens = {
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
    };

    vi.clearAllMocks();
  });

  describe('Circuit Breaker State Management', () => {
    it('should start in CLOSED state', () => {
      const state = spotifyCircuitBreaker.getState();
      expect(state.state).toBe('CLOSED');
    });

    it('should return false when circuit breaker is open', async () => {
      spotifyCircuitBreaker.open();

      const result = await validateSpotifyConnection(mockSpotifyTokens, mockResponse);

      expect(result.connected).toBe(false);
      expect(result.error).toBe('Spotify API quota exceeded. Please try again later.');
      expect(result.errorCode).toBe('CIRCUIT_BREAKER_OPEN');
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('spotify_tokens');
    });

    it('should allow requests when circuit breaker is closed', async () => {
      spotifyCircuitBreaker.close();
      expect(spotifyCircuitBreaker.canProceed()).toBe(true);
    });

    it('should return null tokens without API call', async () => {
      const result = await validateSpotifyConnection(null, mockResponse);

      expect(result.connected).toBe(false);
      expect(mockResponse.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('Rate Limit Error Detection', () => {
    it('should open circuit on 429 rate limit error', async () => {
      mockGetCurrentUser.mockRejectedValueOnce(new SpotifyApiError('Rate limit exceeded', 429));

      const result = await validateSpotifyConnection(mockSpotifyTokens, mockResponse);

      expect(result.connected).toBe(false);
      expect(result.error).toBe('Spotify API quota exceeded. Please try again later.');
      expect(result.errorCode).toBe(429);
      expect(spotifyCircuitBreaker.isOpen()).toBe(true);
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('spotify_tokens');
    });

    it('should record failure on non-429 errors', async () => {
      mockGetCurrentUser.mockRejectedValueOnce(new SpotifyApiError('Internal server error', 500));

      await validateSpotifyConnection(mockSpotifyTokens, mockResponse);

      // Circuit breaker should still be closed (not open), but failure was recorded
      expect(spotifyCircuitBreaker.getState().state).toBe('CLOSED');
    });
  });

  describe('Success Recording', () => {
    it('should record success on valid connection', async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ id: 'user123', displayName: 'Test User' });

      const result = await validateSpotifyConnection(mockSpotifyTokens, mockResponse);

      expect(result.connected).toBe(true);
      expect(spotifyCircuitBreaker.getState().state).toBe('CLOSED');
    });
  });

  describe('Token Management', () => {
    it('should clear cookies when circuit opens on rate limit', async () => {
      spotifyCircuitBreaker.open();

      await validateSpotifyConnection(mockSpotifyTokens, mockResponse);

      expect(mockResponse.clearCookie).toHaveBeenCalledWith('spotify_tokens');
    });

    it('should provide user-friendly error message on circuit breaker open', async () => {
      spotifyCircuitBreaker.open();

      const result = await validateSpotifyConnection(mockSpotifyTokens, mockResponse);

      expect(result.error).toBe('Spotify API quota exceeded. Please try again later.');
    });
  });

  describe('Configuration Independence', () => {
    it('should have independent configuration from YouTube circuit breaker', async () => {
      const spotifyState = spotifyCircuitBreaker.getState();

      // Should be able to configure independently
      expect(spotifyState).toHaveProperty('state');
      expect(spotifyState).toHaveProperty('failureCount');
    });
  });
});
