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
    it('should have contrasting borders for red sync buttons (btn-primary.sync-btn)', () => {
      // Check for the btn-primary.sync-btn rule
      const btnPrimaryMatch = cssContent.match(/\.btn-primary\.sync-btn\s*{[^}]*}/);
      expect(btnPrimaryMatch).toBeTruthy();

      const btnPrimaryStyles = btnPrimaryMatch?.[0] || '';
      expect(btnPrimaryStyles).toContain('border-color: var(--border)');
      expect(btnPrimaryStyles).not.toContain('border-color: #ff0040');
    });

    it('should have contrasting borders for green update buttons (btn-outline-success.sync-btn)', () => {
      // Check for the btn-outline-success.sync-btn rule
      const btnSuccessMatch = cssContent.match(/\.btn-outline-success\.sync-btn\s*{[^}]*}/);
      expect(btnSuccessMatch).toBeTruthy();

      const btnSuccessStyles = btnSuccessMatch?.[0] || '';
      expect(btnSuccessStyles).toContain('border-color: var(--border)');
      expect(btnSuccessStyles).not.toContain('border-color: #00ff00');
    });

    it('should have contrasting borders for disabled gray buttons (btn-secondary)', () => {
      // Check for the punk-btn rule (generic button styling) - it may have combined selectors
      expect(cssContent).toContain('.punk-btn');
      expect(cssContent).toMatch(/\.punk-btn[\s\S]*?border:\s*2px solid var\(--border\)/);

      // Check for the btn-secondary.punk-btn rule (color variant)
      expect(cssContent).toMatch(
        /\.btn-secondary\.punk-btn[\s\S]*?border-color:\s*var\(--border\)/,
      );
    });
  });

  describe('Primary button styling', () => {
    it('keeps the borderless marker button reading as a control (btn-outline-primary)', () => {
      const btnOutlinePrimaryMatch = cssContent.match(/\.btn-outline-primary\s*{[^}]*}/);
      expect(btnOutlinePrimaryMatch).toBeTruthy();

      const btnOutlinePrimaryStyles = btnOutlinePrimaryMatch?.[0] || '';
      // This one is scrawled on in marker, not stamped in a box - it has no border on purpose.
      expect(btnOutlinePrimaryStyles).toContain('border: none');
      // Which puts the whole affordance on the ink chip and its offset shadow: lose either and the
      // control stops looking pressable, which is what the old border rule was really protecting.
      expect(btnOutlinePrimaryStyles).toMatch(/background-color:\s*#0066ff/);
      expect(btnOutlinePrimaryStyles).toMatch(/box-shadow:\s*3px 3px 0px/);
    });
  });

  describe('Connection button styling', () => {
    it('should have contrasting borders for connection buttons (connect-btn)', () => {
      // Check for the connect-btn rule
      const connectBtnMatch = cssContent.match(/\.connect-btn\s*{[^}]*}/);
      expect(connectBtnMatch).toBeTruthy();

      const connectBtnStyles = connectBtnMatch?.[0] || '';
      expect(connectBtnStyles).toContain('border: 3px solid var(--border)');
    });
  });

  describe('Auth expired button styling', () => {
    it('should have contrasting borders for Spotify reconnect buttons', () => {
      // Check for btn-spotify-reconnect rule
      const spotifyReconnectMatch = cssContent.match(/\.btn-spotify-reconnect[^{]*{[^}]*}/);
      expect(spotifyReconnectMatch).toBeTruthy();

      const spotifyReconnectStyles = spotifyReconnectMatch?.[0] || '';
      expect(spotifyReconnectStyles).toContain('border: 2px solid var(--border)');
    });

    it('should have contrasting borders for YouTube reconnect buttons', () => {
      // Check for btn-youtube-reconnect rule
      const youtubeReconnectMatch = cssContent.match(/\.btn-youtube-reconnect[^{]*{[^}]*}/);
      expect(youtubeReconnectMatch).toBeTruthy();

      const youtubeReconnectStyles = youtubeReconnectMatch?.[0] || '';
      expect(youtubeReconnectStyles).toContain('border: 2px solid var(--border)');
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
      // Check that hover states maintain contrasting borders
      const hoverPatterns = [
        /\.btn-primary\.sync-btn:hover\s*{[^}]*border-color:\s*var\(--border\)/,
        /\.btn-outline-success\.sync-btn:hover\s*{[^}]*border-color:\s*var\(--border\)/,
        /\.btn-outline-primary:hover\s*{[^}]*border:\s*2px solid var\(--border\)/,
        /\.btn-secondary:hover\s*{[^}]*border-color:\s*var\(--border\)/,
      ];

      hoverPatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have contrasting borders on all button active states', () => {
      // Check that active states maintain contrasting borders
      const activePatterns = [
        /\.btn-primary\.sync-btn:active[^{]*{[^}]*border-color:\s*var\(--border\)/,
        /\.btn-outline-success\.sync-btn:active[^{]*{[^}]*border-color:\s*var\(--border\)/,
        /\.btn-outline-primary:active[^{]*{[^}]*border:\s*2px solid var\(--border\)/,
      ];

      activePatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have contrasting borders on all button disabled states', () => {
      // Check that disabled states maintain contrasting borders
      const disabledPatterns = [
        /\.btn-primary\.sync-btn:disabled[^{]*{[^}]*border-color:\s*var\(--border\)/,
        /\.btn-outline-success\.sync-btn:disabled[^{]*{[^}]*border-color:\s*var\(--border\)/,
      ];

      disabledPatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });
  });

  describe('Punk aesthetic consistency', () => {
    it('should use the typewriter face for all buttons', () => {
      const buttonFontPatterns = [
        /\.connect-btn[\s\S]*?font-family:\s*'Special Elite'/,
        /\.punk-btn[\s\S]*?font-family:\s*'Special Elite'/,
        /\.btn-outline-secondary[\s\S]*?font-family:\s*'Special Elite'/,
        /\.btn-outline-primary[\s\S]*?font-family:\s*'Special Elite'/,
        /\.btn-spotify-reconnect[\s\S]*?font-family:\s*'Special Elite'/,
        /\.btn-youtube-reconnect[\s\S]*?font-family:\s*'Special Elite'/,
      ];

      buttonFontPatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have uppercase text for all buttons', () => {
      const buttonUppercasePatterns = [
        /\.connect-btn[\s\S]*?text-transform:\s*uppercase/,
        /\.punk-btn[\s\S]*?text-transform:\s*uppercase/,
        /\.btn-outline-secondary[\s\S]*?text-transform:\s*uppercase/,
        /\.btn-outline-primary[\s\S]*?text-transform:\s*uppercase/,
        /\.btn-spotify-reconnect[\s\S]*?text-transform:\s*uppercase/,
      ];

      buttonUppercasePatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have box-shadow for all buttons', () => {
      const buttonShadowPatterns = [
        /\.connect-btn[\s\S]*?box-shadow:/,
        /\.punk-btn[\s\S]*?box-shadow:/,
        /\.btn-outline-secondary[\s\S]*?box-shadow:/,
        /\.btn-outline-primary[\s\S]*?box-shadow:/,
        /\.btn-spotify-reconnect[\s\S]*?box-shadow:/,
      ];

      buttonShadowPatterns.forEach((pattern) => {
        expect(cssContent).toMatch(pattern);
      });
    });

    it('should have zero border-radius for all buttons (sharp punk aesthetic)', () => {
      const buttonRadiusPatterns = [
        /\.connect-btn[\s\S]*?border-radius:\s*0/,
        /\.punk-btn[\s\S]*?border-radius:\s*0/,
        /\.btn-outline-secondary[\s\S]*?border-radius:\s*0/,
        /\.btn-outline-primary[\s\S]*?border-radius:\s*0/,
        /\.btn-spotify-reconnect[\s\S]*?border-radius:\s*0/,
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
