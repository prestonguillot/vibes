/**
 * Unit tests for track matching algorithm
 * Ensures optimalTrackMatching returns correct MatchingResult structure
 */

import { describe, it, expect } from 'vitest';
import { optimalTrackMatching } from '../../src/utils/trackMatching';

describe('optimalTrackMatching', () => {
  describe('Return type validation', () => {
    it('should return a MatchingResult object with matches and scores properties', () => {
      const tracks = [
        {
          id: 'spotify-1',
          name: 'Test Song',
          artist: 'Test Artist'
        }
      ];

      const videos = [
        {
          id: 'video-1',
          title: 'Test Song - Test Artist',
          description: 'Official video',
          channelTitle: 'Test Channel'
        }
      ];

      const result = optimalTrackMatching(tracks, videos);

      // Verify result is an object
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');

      // Verify matches property exists and is a Map
      expect(result.matches).toBeDefined();
      expect(result.matches instanceof Map).toBe(true);

      // Verify scores property exists and is a Map
      expect(result.scores).toBeDefined();
      expect(result.scores instanceof Map).toBe(true);
    });

    it('should have .matches property with track IDs as keys', () => {
      const tracks = [
        {
          id: 'spotify-1',
          name: 'Song A',
          artist: 'Artist A'
        },
        {
          id: 'spotify-2',
          name: 'Song B',
          artist: 'Artist B'
        }
      ];

      const videos = [
        {
          id: 'video-1',
          title: 'Song A',
          description: '',
          channelTitle: 'Artist A'
        },
        {
          id: 'video-2',
          title: 'Song B',
          description: '',
          channelTitle: 'Artist B'
        }
      ];

      const result = optimalTrackMatching(tracks, videos);

      // Verify matches is a Map
      expect(result.matches instanceof Map).toBe(true);

      // Verify we can use .get() on matches
      const match1 = result.matches.get('spotify-1');
      expect(match1).toBeDefined();

      // If there's a match, it should have id property
      if (match1) {
        expect(match1.id).toBeDefined();
        expect(typeof match1.id).toBe('string');
      }
    });

    it('should have .scores property with score information', () => {
      const tracks = [
        {
          id: 'spotify-1',
          name: 'Test Song',
          artist: 'Test Artist'
        }
      ];

      const videos = [
        {
          id: 'video-1',
          title: 'Test Song',
          description: 'Test Artist official video',
          channelTitle: 'Test Artist'
        }
      ];

      const result = optimalTrackMatching(tracks, videos);

      // Verify scores is a Map
      expect(result.scores instanceof Map).toBe(true);

      // Get score for the track
      const score = result.scores.get('spotify-1');

      // If there's a score, verify it has expected structure
      if (score) {
        expect(score).toBeDefined();
        expect(typeof score).toBe('object');
        // ScoreBreakdown should have totalScore property
        expect('totalScore' in score).toBe(true);
      }
    });
  });

  describe('Sync usage pattern - accessing .matches.get()', () => {
    it('should allow sync code to access matches with .matches.get(trackId)', () => {
      const tracks = [
        {
          id: 'track-1',
          name: 'Song',
          artist: 'Artist'
        }
      ];

      const videos = [
        {
          id: 'video-1',
          title: 'Song',
          description: '',
          channelTitle: 'Artist'
        }
      ];

      const trackMatches = optimalTrackMatching(tracks, videos);

      // This is the pattern used in sync.ts line 455
      // It should NOT throw "trackMatches.get is not a function"
      expect(() => {
        const matchingVideo = trackMatches.matches.get('track-1');
        // matchingVideo can be undefined or a video object
        expect(matchingVideo === undefined || typeof matchingVideo === 'object').toBe(true);
      }).not.toThrow();
    });

    it('should throw error if trying to call .get() directly on MatchingResult', () => {
      const tracks = [
        {
          id: 'track-1',
          name: 'Song',
          artist: 'Artist'
        }
      ];

      const videos = [
        {
          id: 'video-1',
          title: 'Song',
          description: '',
          channelTitle: 'Artist'
        }
      ];

      const trackMatches = optimalTrackMatching(tracks, videos);

      // This is the bug that was in sync.ts - calling .get() directly on MatchingResult
      // It SHOULD throw "trackMatches.get is not a function"
      expect(() => {
        // @ts-expect-error - This is intentionally wrong to test the bug scenario
        trackMatches.get('track-1');
      }).toThrow();
    });
  });

  describe('Empty inputs', () => {
    it('should handle empty track list', () => {
      const result = optimalTrackMatching([], [
        {
          id: 'video-1',
          title: 'Song',
          description: '',
          channelTitle: 'Artist'
        }
      ]);

      expect(result.matches instanceof Map).toBe(true);
      expect(result.scores instanceof Map).toBe(true);
      expect(result.matches.size).toBe(0);
      expect(result.scores.size).toBe(0);
    });

    it('should handle empty video list', () => {
      const result = optimalTrackMatching([
        {
          id: 'track-1',
          name: 'Song',
          artist: 'Artist'
        }
      ], []);

      expect(result.matches instanceof Map).toBe(true);
      expect(result.scores instanceof Map).toBe(true);
      // No videos to match, so matches should be empty
      expect(result.matches.size).toBe(0);
    });

    it('should handle both empty lists', () => {
      const result = optimalTrackMatching([], []);

      expect(result.matches instanceof Map).toBe(true);
      expect(result.scores instanceof Map).toBe(true);
      expect(result.matches.size).toBe(0);
      expect(result.scores.size).toBe(0);
    });
  });
});
