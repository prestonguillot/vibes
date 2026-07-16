import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatErrorDetails, formatRetryAfter } from '../../src/lib/errorFormatter';

/**
 * The point of formatErrorDetails is to keep an error's real message out of a production response,
 * where the message can name a file path, a query, or an internal service. In development it shows
 * the message so a developer can see what broke. Flip that in either direction and either the
 * developer is blind or production is leaking - and nothing tested the production side at all.
 */
describe('formatErrorDetails', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('shows the real message in development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(formatErrorDetails(new Error('connection to db-primary:5432 refused'))).toBe(
      'connection to db-primary:5432 refused',
    );
  });

  it('hides the real message in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const formatted = formatErrorDetails(new Error('connection to db-primary:5432 refused'));

    expect(formatted).not.toContain('db-primary');
    expect(formatted).toBe('An error occurred. Please try again or contact support.');
  });

  // Anything but the literal 'production' is treated as development - a misspelled or unset NODE_ENV
  // must not accidentally expose messages, but the check is === 'production', so 'staging' shows
  // them. Pinned as the behaviour it is.
  it.each([['staging'], ['test'], ['']])('treats NODE_ENV=%o as development', (env) => {
    vi.stubEnv('NODE_ENV', env);

    expect(formatErrorDetails(new Error('leak'))).toBe('leak');
  });

  it('says "Unknown error" for a non-Error thrown in development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(formatErrorDetails('a bare string')).toBe('Unknown error');
  });

  it('still hides a non-Error in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(formatErrorDetails({ secret: 'value' })).toBe(
      'An error occurred. Please try again or contact support.',
    );
  });
});

describe('formatRetryAfter', () => {
  it('renders sub-minute delays in seconds', () => {
    expect(formatRetryAfter(1)).toBe('1 second');
    expect(formatRetryAfter(45)).toBe('45 seconds');
    expect(formatRetryAfter(59)).toBe('59 seconds');
  });

  it('renders minute-scale delays in minutes', () => {
    expect(formatRetryAfter(60)).toBe('1 minute');
    expect(formatRetryAfter(150)).toBe('3 minutes'); // 2.5 -> rounds to 3
    expect(formatRetryAfter(3599)).toBe('60 minutes');
  });

  it('renders hour-scale delays in hours', () => {
    expect(formatRetryAfter(3600)).toBe('1 hour');
    expect(formatRetryAfter(43200)).toBe('12 hours');
  });

  it('never renders a zero/negative delay', () => {
    expect(formatRetryAfter(0)).toBe('1 second');
    expect(formatRetryAfter(-5)).toBe('1 second');
  });
});
