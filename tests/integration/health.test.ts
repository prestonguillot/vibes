/**
 * Integration tests for application endpoints
 * Tests actual routes without making real API calls (mocked)
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { findSetCookie, setCookies } from '@tests/helpers/httpCookies';
import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';

const app = testServer(createApp());

describe('Health Check', () => {
  describe('GET /health', () => {
    it('should return 200 OK with status and timestamp', async () => {
      const response = await request(app).get('/health').expect(200).expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });
  });
});

describe('Main Page', () => {
  describe('GET /', () => {
    it('should return 200 OK with HTML', async () => {
      const response = await request(app).get('/').expect(200).expect('Content-Type', /html/);

      // Should render index page with basic structure
      expect(response.text).toContain('<!DOCTYPE html>');
      expect(response.text).toContain('Spotify');
      expect(response.text).toContain('YouTube');
    });

    it('should set CSRF cookie', async () => {
      const response = await request(app).get('/');

      expect(setCookies(response)).not.toHaveLength(0);
      expect(findSetCookie(response, 'csrf_token')).toBeDefined();
    });
  });
});

describe('404 Handler', () => {
  describe('GET /nonexistent', () => {
    it('should return 404 with error message', async () => {
      const response = await request(app).get('/nonexistent').expect(404);

      // Should render error message partial
      expect(response.text).toContain('Page not found');
    });
  });

  describe('POST /nonexistent', () => {
    it('should return 404 for POST to nonexistent route', async () => {
      const response = await request(app).post('/nonexistent').expect(404);

      expect(response.text).toContain('Page not found');
    });
  });
});
