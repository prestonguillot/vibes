import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { youtubeCircuitBreaker } from '../../src/lib/circuitBreaker';

// The connection-status buttons enforce a minimum on-screen time (anti-flash). The
// delay LOGIC is unit-tested deterministically in tests/unit/minDisplayTime.test.ts;
// here we stub it to a no-op so these tests are fast and never measure wall-clock,
// and assert the endpoints wire it up and render the button correctly.
const h = vi.hoisted(() => ({ enforceMinDisplayTime: vi.fn(() => Promise.resolve()) }));
vi.mock('../../src/lib/minDisplayTime', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/minDisplayTime')>()),
  enforceMinDisplayTime: h.enforceMinDisplayTime,
}));

const app = createApp();

describe('Status button endpoints', () => {
  beforeEach(() => {
    h.enforceMinDisplayTime.mockClear();
    youtubeCircuitBreaker.close();
  });

  it('Spotify: enforces the min-display time and renders the button', async () => {
    const response = await request(app).get('/api/status/spotify/button');

    expect(response.status).toBe(200);
    expect(h.enforceMinDisplayTime).toHaveBeenCalledTimes(1);
    expect(response.text).toContain('data-service="spotify"');
    expect(response.text).toMatch(/data-connected="(true|false)"/);
    expect(response.text).toMatch(/(Connect Spotify|Connected)/);
  });

  it('YouTube: enforces the min-display time and renders the button', async () => {
    const response = await request(app).get('/api/status/youtube/button');

    expect(response.status).toBe(200);
    expect(h.enforceMinDisplayTime).toHaveBeenCalledTimes(1);
    expect(response.text).toContain('data-service="youtube"');
    expect(response.text).toMatch(/(Connect Youtube|Connected)/);
  });
});
