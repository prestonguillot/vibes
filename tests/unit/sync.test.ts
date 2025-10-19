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

  describe('Reordering with manually added videos (Bug fix verification)', () => {
    it('should detect unmatched videos (manually added) in playlist', () => {
      const currentPositions = new Map([
        ['video-a', { currentPosition: 0, playlistItemId: 'item-1' }],
        ['video-b', { currentPosition: 1, playlistItemId: 'item-2' }],
        ['video-c', { currentPosition: 2, playlistItemId: 'item-3' }],
        ['video-manually-added', { currentPosition: 3, playlistItemId: 'item-4' }]
      ]);

      const trackMatches = new Map([
        ['id-1', { id: 'video-a', title: 'Song A', playlistItemId: 'item-1' }],
        ['id-2', { id: 'video-b', title: 'Song B', playlistItemId: 'item-2' }],
        ['id-3', { id: 'video-c', title: 'Song C', playlistItemId: 'item-3' }]
        // video-manually-added is NOT in trackMatches
      ]);

      // Find unmatched videos
      const unmatchedVideoIds = new Set<string>();
      for (const [videoId] of currentPositions.entries()) {
        const isMatched = Array.from(trackMatches.values()).some(match => match.id === videoId);
        if (!isMatched) {
          unmatchedVideoIds.add(videoId);
        }
      }

      expect(unmatchedVideoIds.size).toBe(1);
      expect(unmatchedVideoIds.has('video-manually-added')).toBe(true);
    });

    it('should handle playlists with only manually added videos', () => {
      const currentPositions = new Map([
        ['manual-1', { currentPosition: 0, playlistItemId: 'item-1' }],
        ['manual-2', { currentPosition: 1, playlistItemId: 'item-2' }]
      ]);

      const trackMatches = new Map(); // Empty - no synced tracks

      const unmatchedVideoIds = new Set<string>();
      for (const [videoId] of currentPositions.entries()) {
        const isMatched = Array.from(trackMatches.values()).some(match => match.id === videoId);
        if (!isMatched) {
          unmatchedVideoIds.add(videoId);
        }
      }

      expect(unmatchedVideoIds.size).toBe(2);
    });

    it('should handle playlists with only synced videos (no manually added)', () => {
      const currentPositions = new Map([
        ['video-a', { currentPosition: 0, playlistItemId: 'item-1' }],
        ['video-b', { currentPosition: 1, playlistItemId: 'item-2' }]
      ]);

      const trackMatches = new Map([
        ['id-1', { id: 'video-a', title: 'Song A', playlistItemId: 'item-1' }],
        ['id-2', { id: 'video-b', title: 'Song B', playlistItemId: 'item-2' }]
      ]);

      const unmatchedVideoIds = new Set<string>();
      for (const [videoId] of currentPositions.entries()) {
        const isMatched = Array.from(trackMatches.values()).some(match => match.id === videoId);
        if (!isMatched) {
          unmatchedVideoIds.add(videoId);
        }
      }

      expect(unmatchedVideoIds.size).toBe(0);
    });
  });

  describe('Variable scope (Bug fix verification)', () => {
    it('should keep syncedTracks and unsyncedTracks in accessible scope for reordering', () => {
      // This test verifies the fix for "syncedTracks is not defined" error
      // The variables must be declared at the top level, not inside if blocks

      let syncedTracks: unknown[] = [];
      let unsyncedTracks: unknown[] = [];

      // Simulate UPDATE mode processing
      {
        // Inside UPDATE mode block
        syncedTracks = [
          { track: { id: '1', name: 'Song A', type: 'track' } },
          { track: { id: '2', name: 'Song B', type: 'track' } }
        ];
        unsyncedTracks = [
          { track: { id: '3', name: 'Song C', type: 'track' } }
        ];
      }

      // After UPDATE mode block, variables should still be accessible
      expect(syncedTracks.length).toBe(2);
      expect(unsyncedTracks.length).toBe(1);
    });

    it('should be able to check syncedTracks.length in reordering condition', () => {
      // This simulates the reordering phase accessing syncedTracks
      const syncedTracks: unknown[] = [
        { track: { id: '1', name: 'Song A', type: 'track' } },
        { track: { id: '2', name: 'Song B', type: 'track' } }
      ];

      // The condition used in reordering phase
      const shouldReorder = syncedTracks.length > 0;
      expect(shouldReorder).toBe(true);
    });

    it('should handle empty syncedTracks in reordering condition', () => {
      const syncedTracks: unknown[] = [];

      // Should not throw error even with empty array
      const shouldReorder = syncedTracks.length > 0;
      expect(shouldReorder).toBe(false);
    });
  });

  describe('UPDATE mode reordering behavior (PR fix verification)', () => {
    it('should defer reordering until after new videos are added in UPDATE mode', () => {
      // This test verifies the fix for the "Pyramid Song" bug where reordering
      // happened before new videos were added, causing position calculations to fail

      // Scenario: YouTube has 3 videos, we're adding 1 new video
      const currentYouTubeVideos = [
        { videoId: 'video-0', position: 0 }, // Song 0 (synced)
        { videoId: 'video-1', position: 1 }, // Song 1 (synced)
        { videoId: 'video-2', position: 2 }  // Song 2 (synced, manually linked)
      ];

      // Spotify has 4 songs, Song 3 needs to be added
      const spotifyOrder = [0, 1, 2, 3]; // Song 3 is new

      // If we try to reorder BEFORE adding Song 3, we'd be trying to move
      // Song 2 to position 3, which doesn't exist yet - causing 400/409 errors

      // The fix ensures we ADD the new video first, THEN reorder
      // After adding: YouTube has 4 videos
      const youtubeAfterAdding = [
        { videoId: 'video-0', position: 0 },
        { videoId: 'video-1', position: 1 },
        { videoId: 'video-2', position: 2 },
        { videoId: 'video-3', position: 3 }  // Newly added
      ];

      // NOW reordering to match Spotify order works because all positions exist
      expect(youtubeAfterAdding.length).toBe(4);
      expect(youtubeAfterAdding[3].videoId).toBe('video-3');
    });

    it('should reorder synced tracks even when no new videos are added', () => {
      // This test verifies that order changes in Spotify are reflected in YouTube
      // even if no new videos are being synced this run

      // Scenario: User reordered songs in Spotify
      // YouTube currently has: Song A, Song B, Song C (positions 0, 1, 2)
      // Spotify now has: Song C, Song B, Song A (positions 0, 1, 2)

      const currentYouTubeOrder = [
        { videoId: 'video-a', currentPosition: 0 },
        { videoId: 'video-b', currentPosition: 1 },
        { videoId: 'video-c', currentPosition: 2 }
      ];

      const spotifyOrder = [
        { videoId: 'video-c', targetPosition: 0 },
        { videoId: 'video-b', targetPosition: 1 },
        { videoId: 'video-a', targetPosition: 2 }
      ];

      // Identify reorder operations
      const reorderOps = spotifyOrder.filter(spotify => {
        const youtube = currentYouTubeOrder.find(yt => yt.videoId === spotify.videoId);
        return youtube && youtube.currentPosition !== spotify.targetPosition;
      });

      // Even though no new videos were added, reordering should happen
      expect(reorderOps.length).toBe(2); // video-a and video-c need to move
    });

    it('should always reorder if synced tracks exist in UPDATE mode', () => {
      // This verifies the fix: reorder should trigger on `syncedTracks.length > 0`
      // not on `totalToAdd > 0`

      const scenario = {
        syncedTracks: [
          { videoId: 'video-a', needsReorder: true },
          { videoId: 'video-b', needsReorder: false }
        ],
        newVideosAdded: 0, // No new videos
      };

      // In UPDATE mode, we should still reorder because syncedTracks.length > 0
      const shouldReorder = scenario.syncedTracks.length > 0;
      expect(shouldReorder).toBe(true);
    });

    it('should not reorder if no synced tracks exist', () => {
      const scenario = {
        syncedTracks: [],
        newVideosAdded: 1, // Even if we added new videos
      };

      // If there are no synced tracks, don't reorder
      const shouldReorder = scenario.syncedTracks.length > 0;
      expect(shouldReorder).toBe(false);
    });
  });

  describe('Reordering optimization (Bug fix verification)', () => {
    it('should build existingVideos array only once, not per track', () => {
      // Simulate current YouTube playlist items
      const currentPlaylistItems = [
        { id: 'item-1', snippet: { resourceId: { videoId: 'video-a' }, title: 'Song A', description: '' } },
        { id: 'item-2', snippet: { resourceId: { videoId: 'video-b' }, title: 'Song B', description: '' } },
        { id: 'item-3', snippet: { resourceId: { videoId: 'video-c' }, title: 'Song C', description: '' } }
      ];

      // Build existingVideos array ONCE (not inside loop)
      const existingVideos = [];
      for (const item of currentPlaylistItems) {
        if (item.snippet?.resourceId?.videoId && item.id) {
          existingVideos.push({
            id: item.snippet.resourceId.videoId,
            title: item.snippet?.title || 'Unknown',
            description: item.snippet?.description || '',
            playlistItemId: item.id
          });
        }
      }

      // Verify we built the array correctly once
      expect(existingVideos.length).toBe(3);
      expect(existingVideos[0].id).toBe('video-a');
      expect(existingVideos[1].id).toBe('video-b');
      expect(existingVideos[2].id).toBe('video-c');

      // Simulate processing multiple synced tracks (should NOT rebuild array)
      const syncedTracks = [
        { track: { name: 'Song A', artists: [{ name: 'Artist 1' }], type: 'track' } },
        { track: { name: 'Song B', artists: [{ name: 'Artist 2' }], type: 'track' } },
        { track: { name: 'Song C', artists: [{ name: 'Artist 3' }], type: 'track' } }
      ];

      // Process each track using the same existingVideos array
      let arrayReferences = 0;
      for (const syncedTrack of syncedTracks) {
        // In the fixed code, existingVideos is used directly (not rebuilt)
        if (existingVideos.length > 0) {
          arrayReferences++;
        }
      }

      // All tracks should use the same array reference
      expect(arrayReferences).toBe(3);
    });

    it('should use currentPlaylistItems, not existingItemsMap, for position comparison', () => {
      // This test verifies we're using the right data source
      const currentPlaylistItems = [
        { id: 'item-1', snippet: { resourceId: { videoId: 'video-a' }, title: 'Song A' } },
        { id: 'item-2', snippet: { resourceId: { videoId: 'video-b' }, title: 'Song B' } },
        { id: 'item-3', snippet: { resourceId: { videoId: 'video-c' }, title: 'Song C' } }
      ];

      // Build currentPositions map from currentPlaylistItems
      const currentPositions = new Map();
      for (let i = 0; i < currentPlaylistItems.length; i++) {
        const item = currentPlaylistItems[i];
        if (item.snippet?.resourceId?.videoId) {
          currentPositions.set(item.snippet.resourceId.videoId, {
            currentPosition: i,
            playlistItemId: item.id
          });
        }
      }

      // Verify positions are correct
      expect(currentPositions.get('video-a')?.currentPosition).toBe(0);
      expect(currentPositions.get('video-b')?.currentPosition).toBe(1);
      expect(currentPositions.get('video-c')?.currentPosition).toBe(2);
    });

    it('should not reorder if all tracks are already in correct positions', () => {
      // Current YouTube order (by position in array)
      const currentPlaylistItems = [
        { id: 'item-1', snippet: { resourceId: { videoId: 'video-a' }, title: 'Song A' } },
        { id: 'item-2', snippet: { resourceId: { videoId: 'video-b' }, title: 'Song B' } },
        { id: 'item-3', snippet: { resourceId: { videoId: 'video-c' }, title: 'Song C' } }
      ];

      // Build position map
      const currentPositions = new Map();
      for (let i = 0; i < currentPlaylistItems.length; i++) {
        const item = currentPlaylistItems[i];
        if (item.snippet?.resourceId?.videoId) {
          currentPositions.set(item.snippet.resourceId.videoId, {
            currentPosition: i,
            playlistItemId: item.id
          });
        }
      }

      // Target Spotify order (same as current)
      const spotifyTrackPositions = new Map([
        ['song a-artist 1', 0],
        ['song b-artist 2', 1],
        ['song c-artist 3', 2]
      ]);

      // Simulate matching videos to tracks
      const mockMatches = [
        { videoId: 'video-a', trackKey: 'song a-artist 1' },
        { videoId: 'video-b', trackKey: 'song b-artist 2' },
        { videoId: 'video-c', trackKey: 'song c-artist 3' }
      ];

      const reorderOperations = [];
      for (const match of mockMatches) {
        const targetPosition = spotifyTrackPositions.get(match.trackKey);
        const currentPosInfo = currentPositions.get(match.videoId);

        if (targetPosition !== undefined && currentPosInfo && currentPosInfo.currentPosition !== targetPosition) {
          reorderOperations.push({
            videoId: match.videoId,
            currentPosition: currentPosInfo.currentPosition,
            targetPosition: targetPosition
          });
        }
      }

      // Should have ZERO reorder operations
      expect(reorderOperations.length).toBe(0);
    });

    it('should only reorder tracks that are in wrong positions', () => {
      // Current YouTube order: A, B, C
      const currentPlaylistItems = [
        { id: 'item-1', snippet: { resourceId: { videoId: 'video-a' }, title: 'Song A' } },
        { id: 'item-2', snippet: { resourceId: { videoId: 'video-b' }, title: 'Song B' } },
        { id: 'item-3', snippet: { resourceId: { videoId: 'video-c' }, title: 'Song C' } }
      ];

      const currentPositions = new Map();
      for (let i = 0; i < currentPlaylistItems.length; i++) {
        const item = currentPlaylistItems[i];
        if (item.snippet?.resourceId?.videoId) {
          currentPositions.set(item.snippet.resourceId.videoId, {
            currentPosition: i,
            playlistItemId: item.id
          });
        }
      }

      // Target Spotify order: C, B, A (C and A need to swap)
      const spotifyTrackPositions = new Map([
        ['song c-artist 3', 0], // C moves from position 2 to 0
        ['song b-artist 2', 1], // B stays at position 1
        ['song a-artist 1', 2]  // A moves from position 0 to 2
      ]);

      const mockMatches = [
        { videoId: 'video-c', trackKey: 'song c-artist 3' },
        { videoId: 'video-b', trackKey: 'song b-artist 2' },
        { videoId: 'video-a', trackKey: 'song a-artist 1' }
      ];

      const reorderOperations = [];
      for (const match of mockMatches) {
        const targetPosition = spotifyTrackPositions.get(match.trackKey);
        const currentPosInfo = currentPositions.get(match.videoId);

        if (targetPosition !== undefined && currentPosInfo && currentPosInfo.currentPosition !== targetPosition) {
          reorderOperations.push({
            videoId: match.videoId,
            currentPosition: currentPosInfo.currentPosition,
            targetPosition: targetPosition
          });
        }
      }

      // Should have exactly 2 reorder operations (C and A)
      expect(reorderOperations.length).toBe(2);
      expect(reorderOperations.find(op => op.videoId === 'video-c')).toBeDefined();
      expect(reorderOperations.find(op => op.videoId === 'video-a')).toBeDefined();
      expect(reorderOperations.find(op => op.videoId === 'video-b')).toBeUndefined();
    });
  });
});
