/**
 * Unit tests for validation schemas
 */

import { describe, it, expect } from 'vitest';
import { schemas } from '@/utils/validation';

describe('Validation Schemas', () => {
  describe('spotifyPlaylistId', () => {
    it('should accept valid Spotify playlist IDs', () => {
      const validIds = [
        '37i9dQZF1DXcBWIGoYBM5M',
        '3cEYpjA9oz9GiPac4AsH4n',
        '5ABHKGoOzxkaa28ttQV9sE'
      ];

      validIds.forEach(id => {
        expect(() => schemas.spotifyPlaylistId.parse(id)).not.toThrow();
      });
    });

    it('should reject invalid Spotify playlist IDs', () => {
      const invalidIds = [
        '',
        'too-short',
        '12345', // too short
        'contains spaces here',
        'contains-dashes-here',
        'contains_underscores_here'
      ];

      invalidIds.forEach(id => {
        expect(() => schemas.spotifyPlaylistId.parse(id)).toThrow();
      });
    });
  });

  describe('youtubePlaylistId', () => {
    it('should accept valid YouTube playlist IDs', () => {
      const validIds = [
        'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
        'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
        'PL9tY0BWXOZFuFEG_GtOBZ8-8wbkH-NVAr',
        'PL1234567890_-' // 13+ chars with dashes and underscores
      ];

      validIds.forEach(id => {
        expect(() => schemas.youtubePlaylistId.parse(id)).not.toThrow();
      });
    });

    it('should reject invalid YouTube playlist IDs', () => {
      const invalidIds = [
        '',
        'too-short', // less than 13 chars
        '12345', // less than 13 chars
        'contains spaces here', // spaces not allowed
        'special!chars' // special chars not allowed
      ];

      invalidIds.forEach(id => {
        expect(() => schemas.youtubePlaylistId.parse(id)).toThrow();
      });
    });
  });

  describe('youtubeVideoId', () => {
    it('should accept valid YouTube video IDs', () => {
      const validIds = [
        'dQw4w9WgXcQ',
        'jNQXAC9IVRw',
        '9bZkp7q19f0',
        '12345678_-0' // exactly 11 chars with underscores and dashes
      ];

      validIds.forEach(id => {
        expect(() => schemas.youtubeVideoId.parse(id)).not.toThrow();
      });
    });

    it('should reject invalid YouTube video IDs', () => {
      const invalidIds = [
        '',
        'short', // less than 11 chars
        'toolongvidid', // more than 11 chars
        'has spaces!', // spaces not allowed (and wrong length)
        'special!chr' // special chars not allowed
      ];

      invalidIds.forEach(id => {
        expect(() => schemas.youtubeVideoId.parse(id)).toThrow();
      });
    });
  });

  describe('batchSize', () => {
    it('should accept valid batch sizes', () => {
      const validSizes = ['1', '5', '10', 'all'];

      validSizes.forEach(size => {
        expect(() => schemas.batchSize.parse(size)).not.toThrow();
      });
    });

    it('should reject invalid batch sizes', () => {
      const invalidSizes = ['0', '25', '50', '100', 'invalid', ''];

      invalidSizes.forEach(size => {
        expect(() => schemas.batchSize.parse(size)).toThrow();
      });
    });

    it('should be string literals not numbers', () => {
      // batchSize expects string literals, not numbers
      expect(schemas.batchSize.parse('10')).toBe('10');
      expect(schemas.batchSize.parse('all')).toBe('all');
    });
  });

  describe('trackName', () => {
    it('should accept valid track names', () => {
      const validNames = [
        'a',
        'Never Gonna Give You Up',
        'Song with (parentheses) and "quotes"',
        'a'.repeat(200) // max length
      ];

      validNames.forEach(name => {
        expect(() => schemas.trackName.parse(name)).not.toThrow();
      });
    });

    it('should reject invalid track names', () => {
      const invalidNames = [
        '',
        'a'.repeat(201) // too long
      ];

      invalidNames.forEach(name => {
        expect(() => schemas.trackName.parse(name)).toThrow();
      });
    });
  });

  describe('artistName', () => {
    it('should accept valid artist names', () => {
      const validNames = [
        'Rick Astley',
        'The Beatles',
        'a'.repeat(200) // max length
      ];

      validNames.forEach(name => {
        expect(() => schemas.artistName.parse(name)).not.toThrow();
      });
    });

    it('should reject invalid artist names', () => {
      const invalidNames = [
        '',
        'a'.repeat(201) // too long
      ];

      invalidNames.forEach(name => {
        expect(() => schemas.artistName.parse(name)).toThrow();
      });
    });
  });

  describe('booleanFlag', () => {
    it('should accept "true" and transform to boolean true', () => {
      const result = schemas.booleanFlag.parse('true');
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('should accept "false" and transform to boolean false', () => {
      const result = schemas.booleanFlag.parse('false');
      expect(result).toBe(false);
      expect(typeof result).toBe('boolean');
    });

    it('should reject invalid boolean strings', () => {
      const invalidValues = ['1', '0', 'yes', 'no', 'TRUE', 'FALSE', '', 'null'];

      invalidValues.forEach(value => {
        expect(() => schemas.booleanFlag.parse(value)).toThrow();
      });
    });

    it('should ensure transformed boolean can be compared with === true/false', () => {
      // This test ensures the bug we fixed doesn't regress
      // The bug was: req.query.ownOnly === 'true' (string comparison)
      // Should be: req.query.ownOnly === true (boolean comparison)

      const trueResult = schemas.booleanFlag.parse('true');
      const falseResult = schemas.booleanFlag.parse('false');

      // These should work (correct comparison)
      expect(trueResult === true).toBe(true);
      expect(falseResult === false).toBe(true);

      // These should fail (the bug we fixed)
      expect(trueResult === 'true').toBe(false);
      expect(falseResult === 'false').toBe(false);
    });
  });
});
