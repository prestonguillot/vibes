/**
 * Unit tests for sync/reordering logic
 */

import { describe, it, expect } from 'vitest';

describe('Sync Playlist Reordering Logic', () => {
  describe('Pagination handling', () => {
    it('should handle single page of results (< 50 items)', () => {
      // Simulate a single page response
      const mockItems = Array.from({ length: 25 }, (_, i) => ({
        id: `item-${i}`,
        snippet: {
          title: `Video ${i}`,
          position: i,
          resourceId: { videoId: `video-${i}` }
        }
      }));

      const allItems = [];
      const firstPage = { items: mockItems, nextPageToken: undefined };

      if (firstPage.items) {
        allItems.push(...firstPage.items);
      }

      expect(allItems.length).toBe(25);
      expect(firstPage.nextPageToken).toBeUndefined();
    });

    it('should handle multiple pages of results (> 50 items)', () => {
      // Simulate paginated response
      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item-${i}`,
          snippet: { position: i, resourceId: { videoId: `video-${i}` } }
        })),
        nextPageToken: 'page2-token'
      };

      const page2 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item-${i + 50}`,
          snippet: { position: i + 50, resourceId: { videoId: `video-${i + 50}` } }
        })),
        nextPageToken: 'page3-token'
      };

      const page3 = {
        items: Array.from({ length: 25 }, (_, i) => ({
          id: `item-${i + 100}`,
          snippet: { position: i + 100, resourceId: { videoId: `video-${i + 100}` } }
        })),
        nextPageToken: undefined
      };

      const allItems = [];
      const pages = [page1, page2, page3];

      for (const page of pages) {
        if (page.items) {
          allItems.push(...page.items);
        }
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(125);
      expect(allItems[0].snippet.position).toBe(0);
      expect(allItems[124].snippet.position).toBe(124);
    });

    it('should handle empty results', () => {
      const emptyPage = { items: [], nextPageToken: undefined };
      const allItems = [];

      if (emptyPage.items) {
        allItems.push(...emptyPage.items);
      }

      expect(allItems.length).toBe(0);
    });
  });

  describe('Position mapping', () => {
    it('should correctly map current positions from playlist items', () => {
      const currentYouTubeOrder = [
        { id: 'item-1', snippet: { resourceId: { videoId: 'video-a' } } },
        { id: 'item-2', snippet: { resourceId: { videoId: 'video-b' } } },
        { id: 'item-3', snippet: { resourceId: { videoId: 'video-c' } } }
      ];

      const currentPositions = new Map();
      for (let i = 0; i < currentYouTubeOrder.length; i++) {
        const item = currentYouTubeOrder[i];
        if (item.snippet?.resourceId?.videoId) {
          currentPositions.set(item.snippet.resourceId.videoId, {
            currentPosition: i,
            playlistItemId: item.id
          });
        }
      }

      expect(currentPositions.size).toBe(3);
      expect(currentPositions.get('video-a')?.currentPosition).toBe(0);
      expect(currentPositions.get('video-b')?.currentPosition).toBe(1);
      expect(currentPositions.get('video-c')?.currentPosition).toBe(2);
    });

    it('should identify tracks that need repositioning', () => {
      // Current YouTube order
      const currentOrder = [
        { videoId: 'video-a', position: 0 },
        { videoId: 'video-b', position: 1 },
        { videoId: 'video-c', position: 2 }
      ];

      // Target Spotify order (all three need to move)
      const targetOrder = [
        { videoId: 'video-c', targetPosition: 0 }, // moves from 2 to 0
        { videoId: 'video-b', targetPosition: 1 }, // stays at 1 (no move needed)
        { videoId: 'video-a', targetPosition: 2 }  // moves from 0 to 2
      ];

      const reorderOperations = [];

      for (const target of targetOrder) {
        const current = currentOrder.find(c => c.videoId === target.videoId);
        if (current && current.position !== target.targetPosition) {
          reorderOperations.push({
            videoId: target.videoId,
            currentPosition: current.position,
            targetPosition: target.targetPosition
          });
        }
      }

      expect(reorderOperations.length).toBe(2); // video-c and video-a need to move
      expect(reorderOperations.find(op => op.videoId === 'video-c')).toBeDefined();
      expect(reorderOperations.find(op => op.videoId === 'video-a')).toBeDefined();
      expect(reorderOperations.find(op => op.videoId === 'video-b')).toBeUndefined(); // video-b stays at position 1
    });

    it('should skip tracks already in correct position', () => {
      const currentOrder = [
        { videoId: 'video-a', position: 0 },
        { videoId: 'video-b', position: 1 },
        { videoId: 'video-c', position: 2 }
      ];

      // Target order is same as current
      const targetOrder = [
        { videoId: 'video-a', targetPosition: 0 },
        { videoId: 'video-b', targetPosition: 1 },
        { videoId: 'video-c', targetPosition: 2 }
      ];

      const reorderOperations = [];

      for (const target of targetOrder) {
        const current = currentOrder.find(c => c.videoId === target.videoId);
        if (current && current.position !== target.targetPosition) {
          reorderOperations.push({
            videoId: target.videoId,
            currentPosition: current.position,
            targetPosition: target.targetPosition
          });
        }
      }

      expect(reorderOperations.length).toBe(0); // No operations needed
    });
  });

  describe('Track matching for reordering', () => {
    it('should create track key from name and artist', () => {
      const track = {
        name: 'Never Gonna Give You Up',
        artists: [{ name: 'Rick Astley' }]
      };

      const trackKey = `${track.name.toLowerCase()}-${track.artists[0]?.name?.toLowerCase() || ''}`;

      expect(trackKey).toBe('never gonna give you up-rick astley');
    });

    it('should handle tracks with no artist', () => {
      const track = {
        name: 'Unknown Track',
        artists: []
      };

      const trackKey = `${track.name.toLowerCase()}-${track.artists[0]?.name?.toLowerCase() || ''}`;

      expect(trackKey).toBe('unknown track-');
    });

    it('should map Spotify track positions correctly', () => {
      const spotifyTracks = [
        { track: { name: 'Song A', artists: [{ name: 'Artist 1' }], type: 'track' } },
        { track: { name: 'Song B', artists: [{ name: 'Artist 2' }], type: 'track' } },
        { track: { name: 'Song C', artists: [{ name: 'Artist 3' }], type: 'track' } }
      ];

      const spotifyTrackPositions = new Map();
      for (let i = 0; i < spotifyTracks.length; i++) {
        const item = spotifyTracks[i];
        if (item.track && item.track.type === 'track') {
          const track = item.track;
          const trackKey = `${track.name.toLowerCase()}-${track.artists[0]?.name?.toLowerCase() || ''}`;
          spotifyTrackPositions.set(trackKey, i);
        }
      }

      expect(spotifyTrackPositions.size).toBe(3);
      expect(spotifyTrackPositions.get('song a-artist 1')).toBe(0);
      expect(spotifyTrackPositions.get('song b-artist 2')).toBe(1);
      expect(spotifyTrackPositions.get('song c-artist 3')).toBe(2);
    });
  });

  describe('Reorder operations sorting', () => {
    it('should sort reorder operations by target position', () => {
      const operations = [
        { videoId: 'video-c', targetPosition: 5, currentPosition: 2 },
        { videoId: 'video-a', targetPosition: 0, currentPosition: 10 },
        { videoId: 'video-b', targetPosition: 3, currentPosition: 7 }
      ];

      operations.sort((a, b) => a.targetPosition - b.targetPosition);

      expect(operations[0].videoId).toBe('video-a'); // targetPosition: 0
      expect(operations[1].videoId).toBe('video-b'); // targetPosition: 3
      expect(operations[2].videoId).toBe('video-c'); // targetPosition: 5
    });

    it('should handle empty operations array', () => {
      const operations: Array<{ targetPosition: number }> = [];

      operations.sort((a, b) => a.targetPosition - b.targetPosition);

      expect(operations.length).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle playlist with exactly 50 items (boundary)', () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `item-${i}`,
        snippet: { position: i, resourceId: { videoId: `video-${i}` } }
      }));

      const page = { items, nextPageToken: undefined };

      expect(page.items.length).toBe(50);
      expect(page.nextPageToken).toBeUndefined();
    });

    it('should handle playlist with 51 items (requires pagination)', () => {
      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({ id: `item-${i}` })),
        nextPageToken: 'page2'
      };

      const page2 = {
        items: Array.from({ length: 1 }, (_, i) => ({ id: `item-${i + 50}` })),
        nextPageToken: undefined
      };

      expect(page1.nextPageToken).toBe('page2');
      expect(page2.nextPageToken).toBeUndefined();
      expect(page1.items.length + page2.items.length).toBe(51);
    });

    it('should handle tracks with special characters in names', () => {
      const track = {
        name: "I'm Bout It, Bout It",
        artists: [{ name: 'Master P' }]
      };

      const trackKey = `${track.name.toLowerCase()}-${track.artists[0]?.name?.toLowerCase() || ''}`;

      expect(trackKey).toBe("i'm bout it, bout it-master p");
    });
  });
});
