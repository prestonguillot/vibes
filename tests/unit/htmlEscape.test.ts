import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../src/utils/htmlEscape';

describe('HTML Escaping Utility', () => {
  it('should escape HTML special characters', () => {
    const input = '<script>alert("XSS")</script>';
    const result = escapeHtml(input);

    expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('should escape ampersands', () => {
    const input = 'Tom & Jerry';
    const result = escapeHtml(input);

    expect(result).toBe('Tom &amp; Jerry');
  });

  it('should escape quotes', () => {
    const input = 'He said "Hello" and I replied \'Hi\'';
    const result = escapeHtml(input);

    expect(result).toBe('He said &quot;Hello&quot; and I replied &#39;Hi&#39;');
  });

  it('should handle attribute injection attempts', () => {
    const input = 'Song" onload="alert(\'xss\')" data-test="';
    const result = escapeHtml(input);

    expect(result).toBe('Song&quot; onload=&quot;alert(&#39;xss&#39;)&quot; data-test=&quot;');
    // The quotes around the onload attribute are escaped, preventing attribute injection
    expect(result).toContain('onload=&quot;');
    expect(result).not.toContain('onload="');
  });

  it('should handle mixed special characters', () => {
    const input = '<img src=x onerror="alert(\'XSS\')" & other < > \'quotes"test';
    const result = escapeHtml(input);

    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&quot;');
    expect(result).toContain('&#39;');
    expect(result).toContain('&amp;');
  });

  it('should return normal text unchanged (other characters)', () => {
    const input = 'This is a normal song title: Imagine by John Lennon (1971)';
    const result = escapeHtml(input);

    expect(result).toBe(input);
  });

  it('should be idempotent when called multiple times on safe input', () => {
    const input = 'Safe text';
    const once = escapeHtml(input);
    const twice = escapeHtml(once);

    expect(once).toBe(twice);
    expect(once).toBe('Safe text');
  });
});
