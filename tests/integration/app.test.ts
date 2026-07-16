/**
 * Tests for the app-level plumbing in src/app.ts that its route suites don't touch: the 404 fall-
 * through, the global error handler, and the small static routes.
 *
 * The error handler is the security-relevant one - in production it must NOT leak the real error
 * message into the response, or a stack detail meant for a log ends up on the user's screen. It was
 * entirely unexercised. It is reached here by making the Spotify-status handler's auth check reject:
 * Express 5 forwards an async rejection to the error middleware.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const mockAuth = vi.hoisted(() => ({
  validateSpotifyConnection: vi.fn(),
  validateYouTubeConnection: vi.fn(),
}));
vi.mock('@/auth/authValidation', () => ({
  validateSpotifyConnection: mockAuth.validateSpotifyConnection,
  validateYouTubeConnection: mockAuth.validateYouTubeConnection,
}));

import { createApp } from '@/app';
import { testServer } from '@tests/helpers/testServer';

const app = testServer(createApp());

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.validateSpotifyConnection.mockResolvedValue({ connected: false });
  mockAuth.validateYouTubeConnection.mockResolvedValue({ connected: false });
});

afterEach(() => vi.unstubAllEnvs());

describe('app: the 404 fall-through', () => {
  it('renders a not-found partial naming the method and url', async () => {
    const response = await request(app).get('/no/such/path');

    expect(response.status).toBe(404);
    expect(response.text).toContain('Page not found');
    expect(response.text).toContain('Cannot GET /no/such/path');
  });
});

describe('app: the global error handler', () => {
  const secret = 'the real internal detail that must not reach a user';
  const boom = (extra: Record<string, unknown> = {}) => Object.assign(new Error(secret), extra);

  it('does NOT leak the real error message outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockAuth.validateSpotifyConnection.mockRejectedValue(boom());

    const response = await request(app).get('/api/status/spotify/button');

    expect(response.status).toBe(500);
    expect(response.text).toContain('Internal server error');
    expect(response.text).not.toContain(secret);
  });

  it('shows the real error message in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockAuth.validateSpotifyConnection.mockRejectedValue(boom());

    const response = await request(app).get('/api/status/spotify/button');

    expect(response.status).toBe(500);
    expect(response.text).toContain(secret);
  });

  it('uses the status the error carries, when it is a number', async () => {
    mockAuth.validateSpotifyConnection.mockRejectedValue(boom({ status: 503 }));

    const response = await request(app).get('/api/status/spotify/button');

    expect(response.status).toBe(503);
  });

  it('defaults to 500 when the error carries no numeric status', async () => {
    mockAuth.validateSpotifyConnection.mockRejectedValue(boom({ status: 'nope' }));

    const response = await request(app).get('/api/status/spotify/button');

    expect(response.status).toBe(500);
  });
});

describe('app: the small static routes', () => {
  it('answers the health check', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('renders the debug component showcase', async () => {
    const response = await request(app).get('/debug/components');

    expect(response.status).toBe(200);
  });
});
