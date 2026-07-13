import { describe, it, expect } from 'vitest';
import { formatRetryAfter } from '../../src/lib/errorFormatter';

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
