import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { youtubeCircuitBreaker } from '../../src/utils/circuitBreaker';

describe('Status Endpoint Timing', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
    youtubeCircuitBreaker.close();
  });

  describe('Minimum Display Time', () => {
    it('should take at least 500ms for Spotify status check', async () => {
      const startTime = Date.now();

      const response = await request(app).get('/api/status/spotify/button');

      const elapsed = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(500);
    });

    it('should take at least 500ms for YouTube status check', async () => {
      const startTime = Date.now();

      const response = await request(app).get('/api/status/youtube/button');

      const elapsed = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(500);
    });

    it('should not delay longer than necessary if validation is slow', async () => {
      // With no tokens, validation should be fast
      // So we should see approximately 500ms (not significantly more)
      const startTime = Date.now();

      const response = await request(app).get('/api/status/spotify/button');

      const elapsed = Date.now() - startTime;

      expect(response.status).toBe(200);
      // Allow some overhead but should be close to 500ms for fast validation
      expect(elapsed).toBeLessThan(700); // 500ms + 200ms margin
    });
  });

  describe('Prevents Flashing', () => {
    it('should provide consistent timing for user experience', async () => {
      // Make multiple requests and verify they all take at least 500ms
      const timings: number[] = [];

      for (let i = 0; i < 3; i++) {
        const startTime = Date.now();
        await request(app).get('/api/status/spotify/button');
        const elapsed = Date.now() - startTime;
        timings.push(elapsed);
      }

      // All requests should meet minimum display time
      timings.forEach((timing) => {
        expect(timing).toBeGreaterThanOrEqual(500);
      });
    });

    it('should render connection button state after minimum display time', async () => {
      const response = await request(app).get('/api/status/spotify/button');

      expect(response.status).toBe(200);
      expect(response.text).toContain('data-service="spotify"');
      expect(response.text).toMatch(/data-connected="(true|false)"/);
    });
  });

  describe('Both Endpoints Have Minimum Display Time', () => {
    it('should apply minimum display time to both Spotify and YouTube', async () => {
      const spotifyStart = Date.now();
      const spotifyResponse = await request(app).get('/api/status/spotify/button');
      const spotifyElapsed = Date.now() - spotifyStart;

      const youtubeStart = Date.now();
      const youtubeResponse = await request(app).get('/api/status/youtube/button');
      const youtubeElapsed = Date.now() - youtubeStart;

      expect(spotifyResponse.status).toBe(200);
      expect(youtubeResponse.status).toBe(200);

      expect(spotifyElapsed).toBeGreaterThanOrEqual(500);
      expect(youtubeElapsed).toBeGreaterThanOrEqual(500);
    });
  });

  describe('Response Content After Delay', () => {
    it('should return valid Spotify button HTML after minimum display time', async () => {
      const response = await request(app).get('/api/status/spotify/button');

      expect(response.status).toBe(200);
      expect(response.text).toContain('spotify');
      expect(response.text).toMatch(/(Connect Spotify|Connected)/);
    });

    it('should return valid YouTube button HTML after minimum display time', async () => {
      const response = await request(app).get('/api/status/youtube/button');

      expect(response.status).toBe(200);
      expect(response.text).toContain('youtube');
      expect(response.text).toMatch(/(Connect Youtube|Connected)/); // Note: template uses "Youtube" not "YouTube"
    });
  });
});
