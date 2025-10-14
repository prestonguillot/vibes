/**
 * Unit tests for button styling consistency
 * Verifies all buttons have contrasting borders
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Button Styling Consistency', () => {
  const cssPath = path.join(__dirname, '../../public/css/style.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  describe('Sync button styling', () => {
    it('should have black borders for red sync buttons (btn-primary.sync-btn)', () => {
      // Check for the btn-primary.sync-btn rule
      const btnPrimaryMatch = cssContent.match(/\.btn-primary\.sync-btn\s*{[^}]*}/);
      expect(btnPrimaryMatch).toBeTruthy();

      const btnPrimaryStyles = btnPrimaryMatch?.[0] || '';
      expect(btnPrimaryStyles).toContain('border-color: #000');
      expect(btnPrimaryStyles).not.toContain('border-color: #ff0040');
    });

    it('should have black borders for green update buttons (btn-outline-success.sync-btn)', () => {
      // Check for the btn-outline-success.sync-btn rule
      const btnSuccessMatch = cssContent.match(/\.btn-outline-success\.sync-btn\s*{[^}]*}/);
      expect(btnSuccessMatch).toBeTruthy();

      const btnSuccessStyles = btnSuccessMatch?.[0] || '';
      expect(btnSuccessStyles).toContain('border-color: #000');
      expect(btnSuccessStyles).not.toContain('border-color: #00ff00');
    });

    it('should have black borders for disabled gray buttons (btn-secondary)', () => {
      // Check for the btn-secondary rule
      const btnSecondaryMatch = cssContent.match(/\.btn-secondary[^-][^{]*{[^}]*}/);
      expect(btnSecondaryMatch).toBeTruthy();

      const btnSecondaryStyles = btnSecondaryMatch?.[0] || '';
      expect(btnSecondaryStyles).toContain('border-color: #000');
      expect(btnSecondaryStyles).toContain('border: 2px solid #000');
    });
  });

  describe('Primary button styling', () => {
    it('should have black borders for blue buttons (btn-outline-primary)', () => {
      // Check for the btn-outline-primary rule
      const btnOutlinePrimaryMatch = cssContent.match(/\.btn-outline-primary\s*{[^}]*}/);
      expect(btnOutlinePrimaryMatch).toBeTruthy();

      const btnOutlinePrimaryStyles = btnOutlinePrimaryMatch?.[0] || '';
      expect(btnOutlinePrimaryStyles).toContain('border: 2px solid #000');
      expect(btnOutlinePrimaryStyles).not.toContain('border: 2px solid #0066ff');
    });
  });

  describe('Connection button styling', () => {
    it('should have black borders for connection buttons (connect-btn)', () => {
      // Check for the connect-btn rule
      const connectBtnMatch = cssContent.match(/\.connect-btn\s*{[^}]*}/);
      expect(connectBtnMatch).toBeTruthy();

      const connectBtnStyles = connectBtnMatch?.[0] || '';
      expect(connectBtnStyles).toContain('border: 3px solid #000');
    });
  });

  describe('Auth expired button styling', () => {
    it('should have black borders for Spotify reconnect buttons', () => {
      // Check for btn-spotify-reconnect rule
      const spotifyReconnectMatch = cssContent.match(/\.btn-spotify-reconnect[^{]*{[^}]*}/);
      expect(spotifyReconnectMatch).toBeTruthy();

      const spotifyReconnectStyles = spotifyReconnectMatch?.[0] || '';
      expect(spotifyReconnectStyles).toContain('border: 2px solid #000');
    });

    it('should have black borders for YouTube reconnect buttons', () => {
      // Check for btn-youtube-reconnect rule
      const youtubeReconnectMatch = cssContent.match(/\.btn-youtube-reconnect[^{]*{[^}]*}/);
      expect(youtubeReconnectMatch).toBeTruthy();

      const youtubeReconnectStyles = youtubeReconnectMatch?.[0] || '';
      expect(youtubeReconnectStyles).toContain('border: 2px solid #000');
    });
  });

  describe('No inline styles in templates', () => {
    it('should not have inline border styles in auth-expired template', () => {
      const authExpiredPath = path.join(__dirname, '../../views/partials/auth-expired.ejs');
      const authExpiredContent = fs.readFileSync(authExpiredPath, 'utf-8');

      // Should not have inline border styles
      expect(authExpiredContent).not.toContain('border: none');
      expect(authExpiredContent).not.toContain('style="background-color:');

      // Should use CSS classes instead
      expect(authExpiredContent).toContain('btn-spotify-reconnect');
      expect(authExpiredContent).toContain('btn-youtube-reconnect');
    });
  });

  describe('Border contrast verification', () => {
    it('should have contrasting borders on all button hover states', () => {
      // Check that hover states maintain black borders
      const hoverPatterns = [
        /\.btn-primary\.sync-btn:hover\s*{[^}]*border-color:\s*#000/,
        /\.btn-outline-success\.sync-btn:hover\s*{[^}]*border-color:\s*#000/,
        /\.btn-outline-primary:hover\s*{[^}]*border:\s*2px solid #000/,
        /\.btn-secondary:hover\s*{[^}]*border-color:\s*#000/,
      ];

      hoverPatterns.forEach((pattern, index) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have contrasting borders on all button active states', () => {
      // Check that active states maintain black borders
      const activePatterns = [
        /\.btn-primary\.sync-btn:active[^{]*{[^}]*border-color:\s*#000/,
        /\.btn-outline-success\.sync-btn:active[^{]*{[^}]*border-color:\s*#000/,
        /\.btn-outline-primary:active[^{]*{[^}]*border:\s*2px solid #000/,
      ];

      activePatterns.forEach((pattern, index) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have contrasting borders on all button disabled states', () => {
      // Check that disabled states maintain black borders
      const disabledPatterns = [
        /\.btn-primary\.sync-btn:disabled[^{]*{[^}]*border-color:\s*#000/,
        /\.btn-outline-success\.sync-btn:disabled[^{]*{[^}]*border-color:\s*#000/,
      ];

      disabledPatterns.forEach((pattern, index) => {
        expect(cssContent).toMatch(pattern);
      });
    });
  });

  describe('Punk aesthetic consistency', () => {
    it('should use Courier Prime font for all buttons', () => {
      const buttonFontPatterns = [
        /\.connect-btn\s*{[^}]*font-family:\s*'Courier Prime'/,
        /\.sync-btn\s*{[^}]*font-family:\s*'Courier Prime'/,
        /\.btn-secondary[^-][^{]*{[^}]*font-family:\s*'Courier Prime'/,
        /\.btn-outline-secondary\s*{[^}]*font-family:\s*'Courier Prime'/,
        /\.btn-outline-primary\s*{[^}]*font-family:\s*'Courier Prime'/,
        /\.btn-spotify-reconnect[^{]*{[^}]*font-family:\s*'Courier Prime'/,
        /\.btn-youtube-reconnect[^{]*{[^}]*font-family:\s*'Courier Prime'/,
      ];

      buttonFontPatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have uppercase text for all buttons', () => {
      const buttonUppercasePatterns = [
        /\.connect-btn\s*{[^}]*text-transform:\s*uppercase/,
        /\.sync-btn\s*{[^}]*text-transform:\s*uppercase/,
        /\.btn-secondary[^-][^{]*{[^}]*text-transform:\s*uppercase/,
        /\.btn-outline-secondary\s*{[^}]*text-transform:\s*uppercase/,
        /\.btn-outline-primary\s*{[^}]*text-transform:\s*uppercase/,
        /\.btn-spotify-reconnect[^{]*{[^}]*text-transform:\s*uppercase/,
      ];

      buttonUppercasePatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have box-shadow for all buttons', () => {
      const buttonShadowPatterns = [
        /\.connect-btn\s*{[^}]*box-shadow:/,
        /\.sync-btn\s*{[^}]*box-shadow:/,
        /\.btn-secondary[^-][^{]*{[^}]*box-shadow:/,
        /\.btn-outline-secondary\s*{[^}]*box-shadow:/,
        /\.btn-outline-primary\s*{[^}]*box-shadow:/,
        /\.btn-spotify-reconnect[^{]*{[^}]*box-shadow:/,
      ];

      buttonShadowPatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have zero border-radius for all buttons (sharp punk aesthetic)', () => {
      const buttonRadiusPatterns = [
        /\.connect-btn\s*{[^}]*border-radius:\s*0/,
        /\.sync-btn\s*{[^}]*border-radius:\s*0/,
        /\.btn-secondary[^-][^{]*{[^}]*border-radius:\s*0/,
        /\.btn-outline-secondary\s*{[^}]*border-radius:\s*0/,
        /\.btn-outline-primary\s*{[^}]*border-radius:\s*0/,
        /\.btn-spotify-reconnect[^{]*{[^}]*border-radius:\s*0/,
      ];

      buttonRadiusPatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });
  });

  describe('Form control cursor styling', () => {
    it('should have pointer cursor for checkbox inputs (form-check-input)', () => {
      const formCheckInputMatch = cssContent.match(/\.form-check-input\s*{[^}]*}/);
      expect(formCheckInputMatch).toBeTruthy();

      const formCheckInputStyles = formCheckInputMatch?.[0] || '';
      expect(formCheckInputStyles).toContain('cursor: pointer');
    });

    it('should have pointer cursor for checkbox labels (form-check-label)', () => {
      const formCheckLabelMatch = cssContent.match(/\.form-check-label\s*{[^}]*}/);
      expect(formCheckLabelMatch).toBeTruthy();

      const formCheckLabelStyles = formCheckLabelMatch?.[0] || '';
      expect(formCheckLabelStyles).toContain('cursor: pointer');
    });

    it('should have pointer cursor for select dropdowns (form-select)', () => {
      // Match both .form-select and select selectors
      const formSelectMatch = cssContent.match(/\.form-select,\s*select\s*{[^}]*}/);
      expect(formSelectMatch).toBeTruthy();

      const formSelectStyles = formSelectMatch?.[0] || '';
      expect(formSelectStyles).toContain('cursor: pointer');
    });
  });
});
