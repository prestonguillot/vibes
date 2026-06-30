import { describe, it, expect } from 'vitest';
import ejs from 'ejs';
import path from 'path';

describe('Error Template Escaping', () => {
  it('should escape HTML in error message', async () => {
    const templatePath = path.join(__dirname, '../../views/partials/error-message.ejs');
    const html = await ejs.renderFile(templatePath, {
      type: 'danger',
      message: '<script>alert("XSS")</script>',
      details: undefined,
    });

    // Should contain escaped script tags, not actual script
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('should escape HTML in error details', async () => {
    const templatePath = path.join(__dirname, '../../views/partials/error-message.ejs');
    const html = await ejs.renderFile(templatePath, {
      type: 'danger',
      message: 'An error occurred',
      details: '<img src=x onerror="alert(\'XSS\')">',
    });

    // Should contain escaped img tag, not actual img
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x onerror');
  });

  it('should escape special characters in message', async () => {
    const templatePath = path.join(__dirname, '../../views/partials/error-message.ejs');
    const html = await ejs.renderFile(templatePath, {
      type: 'warning',
      message: 'Error with & < > " \' characters',
      details: undefined,
    });

    // Should contain escaped special characters
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });
});
