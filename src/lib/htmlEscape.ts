/**
 * HTML entity escaping utility
 * Prevents XSS attacks by escaping special HTML characters
 */

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param text - The text to escape
 * @returns The escaped text safe for use in HTML attributes and content
 */
export function escapeHtml(text: string): string {
  const htmlEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
}
