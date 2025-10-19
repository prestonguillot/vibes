import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { YouTubeVideo } from '../../src/services/youtube';
import type { Track } from '../../src/services/spotify';

describe('Sync Reordering - Manual Addition Scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Scenario: Tracks 1, 2, 4 exist, adding track 3', () => {
    it('should reorder all tracks including newly added ones to match Spotify order', async () => {
      // Setup: Spotify has 4 tracks in order
      const spotifyTracks: Track[] = [
        { id: 'spotify-1', name: '3rd Planet', artists: [{ name: 'Modest Mouse' }] },
        { id: 'spotify-2', name: "I'm So Tired", artists: [{ name: 'Fugazi' }] },
        { id: 'spotify-3', name: 'Fred Jones Part 2', artists: [{ name: 'Ben Folds' }] },
        { id: 'spotify-4', name: 'Pyramid Song', artists: [{ name: 'Radiohead' }] }
      ];

      // YouTube initially has tracks 1, 2, and 4 (track 3 is missing)
      const initialYouTubeVideos: YouTubeVideo[] = [
        {
          id: 'youtube-1',
          title: '3rd Planet - Modest Mouse',
          thumbnail: '',
          playlistItemId: 'item-1',
          position: 0,
          snippet: {
            title: '3rd Planet - Modest Mouse',
            thumbnails: { default: { url: '' } },
            resourceId: { videoId: 'youtube-1' },
            position: 0
          }
        },
        {
          id: 'youtube-2',
          title: "I'm So Tired - Fugazi",
          thumbnail: '',
          playlistItemId: 'item-2',
          position: 1,
          snippet: {
            title: "I'm So Tired - Fugazi",
            thumbnails: { default: { url: '' } },
            resourceId: { videoId: 'youtube-2' },
            position: 1
          }
        },
        {
          id: 'youtube-4',
          title: 'Pyramid Song - Radiohead',
          thumbnail: '',
          playlistItemId: 'item-4',
          position: 2,
          snippet: {
            title: 'Pyramid Song - Radiohead',
            thumbnails: { default: { url: '' } },
            resourceId: { videoId: 'youtube-4' },
            position: 2
          }
        }
      ];

      // Simulate YouTube search finding track 3

      // Mock adding track 3 to the end of the playlist
      const addedVideo: YouTubeVideo = {
        id: 'youtube-3',
        title: 'Fred Jones Part 2 - Ben Folds',
        thumbnail: '',
        playlistItemId: 'item-3',
        position: 3, // Added at the end
        snippet: {
          title: 'Fred Jones Part 2 - Ben Folds',
          thumbnails: { default: { url: '' } },
          resourceId: { videoId: 'youtube-3' },
          position: 3
        }
      };

      // After adding track 3, YouTube has [1, 2, 4, 3]
      const afterAdditionYouTubeVideos = [...initialYouTubeVideos, addedVideo];

      // Expected final order should be [1, 2, 3, 4]
      const expectedFinalOrder = ['youtube-1', 'youtube-2', 'youtube-3', 'youtube-4'];

      // Simulate the sync process
      const syncedTracks = [
        { track: spotifyTracks[0], matchedVideoId: 'youtube-1' },
        { track: spotifyTracks[1], matchedVideoId: 'youtube-2' },
        { track: spotifyTracks[3], matchedVideoId: 'youtube-4' }
      ];

      const newlyAddedTracks = [
        { track: spotifyTracks[2], matchedVideoId: 'youtube-3' }
      ];

      // ALL synced tracks (existing + newly added)
      const allSyncedTracks = [...syncedTracks, ...newlyAddedTracks];

      // Create the target order based on Spotify
      const targetOrder: string[] = [];
      for (const spotifyTrack of spotifyTracks) {
        const syncedTrack = allSyncedTracks.find(st => st.track.id === spotifyTrack.id);
        if (syncedTrack) {
          targetOrder.push(syncedTrack.matchedVideoId);
        }
      }

      expect(targetOrder).toEqual(expectedFinalOrder);

      // Current YouTube order after adding track 3: [1, 2, 4, 3]
      const currentOrder = afterAdditionYouTubeVideos.map(v => v.id);
      expect(currentOrder).toEqual(['youtube-1', 'youtube-2', 'youtube-4', 'youtube-3']);

      // Calculate reordering operations
      const operations: Array<{ videoId: string; fromPosition: number; toPosition: number }> = [];
      const workingOrder = [...currentOrder];

      for (let finalPosition = 0; finalPosition < targetOrder.length; finalPosition++) {
        const videoId = targetOrder[finalPosition];
        const currentPosition = workingOrder.indexOf(videoId);

        if (currentPosition !== finalPosition) {
          operations.push({
            videoId: videoId,
            fromPosition: currentPosition,
            toPosition: finalPosition
          });

          // Simulate the reordering
          workingOrder.splice(currentPosition, 1);
          workingOrder.splice(finalPosition, 0, videoId);
        }
      }

      // Should have one operation: moving youtube-3 from position 3 to position 2
      expect(operations.length).toBeGreaterThan(0);

      // The key operation should be moving track 3 to its correct position
      const track3Operation = operations.find(op => op.videoId === 'youtube-3');
      expect(track3Operation).toBeDefined();
      expect(track3Operation?.fromPosition).toBe(3);
      expect(track3Operation?.toPosition).toBe(2);

      // Final working order should match expected
      expect(workingOrder).toEqual(expectedFinalOrder);
    });

    it('should handle complex reordering with multiple manual additions', async () => {
      // Spotify order: [1, 2, 3, 4, 5, 6]
      const spotifyTracks: Track[] = [
        { id: 'spotify-1', name: 'Track 1', artists: [{ name: 'Artist' }] },
        { id: 'spotify-2', name: 'Track 2', artists: [{ name: 'Artist' }] },
        { id: 'spotify-3', name: 'Track 3', artists: [{ name: 'Artist' }] },
        { id: 'spotify-4', name: 'Track 4', artists: [{ name: 'Artist' }] },
        { id: 'spotify-5', name: 'Track 5', artists: [{ name: 'Artist' }] },
        { id: 'spotify-6', name: 'Track 6', artists: [{ name: 'Artist' }] }
      ];

      // YouTube has [1, 2, 5, 6] initially (missing 3 and 4)
      // After adding 3 and 4 to the end: [1, 2, 5, 6, 3, 4]
      const currentYouTubeOrder = ['youtube-1', 'youtube-2', 'youtube-5', 'youtube-6', 'youtube-3', 'youtube-4'];

      // Target order based on Spotify: [1, 2, 3, 4, 5, 6]
      const targetOrder = ['youtube-1', 'youtube-2', 'youtube-3', 'youtube-4', 'youtube-5', 'youtube-6'];

      // Simulate reordering algorithm
      const workingOrder = [...currentYouTubeOrder];
      const operations: Array<{ videoId: string; fromPosition: number; toPosition: number }> = [];

      for (let finalPosition = 0; finalPosition < targetOrder.length; finalPosition++) {
        const videoId = targetOrder[finalPosition];
        const currentPosition = workingOrder.indexOf(videoId);

        if (currentPosition !== finalPosition) {
          operations.push({
            videoId: videoId,
            fromPosition: currentPosition,
            toPosition: finalPosition
          });

          // Simulate the reordering
          workingOrder.splice(currentPosition, 1);
          workingOrder.splice(finalPosition, 0, videoId);
        }
      }

      // Should have multiple reordering operations
      expect(operations.length).toBeGreaterThan(0);

      // Track 3 should move from position 4 to position 2
      const track3Op = operations.find(op => op.videoId === 'youtube-3');
      expect(track3Op).toBeDefined();

      // Track 4 should move to position 3
      const track4Op = operations.find(op => op.videoId === 'youtube-4');
      expect(track4Op).toBeDefined();

      // Final order should match target
      expect(workingOrder).toEqual(targetOrder);
    });

    it('should correctly identify when no reordering is needed', async () => {
      // If tracks are already in correct order, no operations should be generated
      const currentOrder = ['youtube-1', 'youtube-2', 'youtube-3', 'youtube-4'];
      const targetOrder = ['youtube-1', 'youtube-2', 'youtube-3', 'youtube-4'];

      const operations: Array<{ videoId: string; fromPosition: number; toPosition: number }> = [];
      const workingOrder = [...currentOrder];

      for (let finalPosition = 0; finalPosition < targetOrder.length; finalPosition++) {
        const videoId = targetOrder[finalPosition];
        const currentPosition = workingOrder.indexOf(videoId);

        if (currentPosition !== finalPosition) {
          operations.push({
            videoId: videoId,
            fromPosition: currentPosition,
            toPosition: finalPosition
          });

          workingOrder.splice(currentPosition, 1);
          workingOrder.splice(finalPosition, 0, videoId);
        }
      }

      // No operations needed when order is correct
      expect(operations.length).toBe(0);
      expect(workingOrder).toEqual(targetOrder);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty playlists', async () => {
      const currentOrder: string[] = [];
      const targetOrder: string[] = [];

      const operations: Array<{ videoId: string; fromPosition: number; toPosition: number }> = [];
      const workingOrder = [...currentOrder];

      for (let finalPosition = 0; finalPosition < targetOrder.length; finalPosition++) {
        const videoId = targetOrder[finalPosition];
        const currentPosition = workingOrder.indexOf(videoId);

        if (currentPosition !== finalPosition) {
          operations.push({
            videoId: videoId,
            fromPosition: currentPosition,
            toPosition: finalPosition
          });

          workingOrder.splice(currentPosition, 1);
          workingOrder.splice(finalPosition, 0, videoId);
        }
      }

      expect(operations.length).toBe(0);
      expect(workingOrder).toEqual([]);
    });

    it('should handle single track playlist', async () => {
      const currentOrder = ['youtube-1'];
      const targetOrder = ['youtube-1'];

      const operations: Array<{ videoId: string; fromPosition: number; toPosition: number }> = [];
      const workingOrder = [...currentOrder];

      for (let finalPosition = 0; finalPosition < targetOrder.length; finalPosition++) {
        const videoId = targetOrder[finalPosition];
        const currentPosition = workingOrder.indexOf(videoId);

        if (currentPosition !== finalPosition) {
          operations.push({
            videoId: videoId,
            fromPosition: currentPosition,
            toPosition: finalPosition
          });

          workingOrder.splice(currentPosition, 1);
          workingOrder.splice(finalPosition, 0, videoId);
        }
      }

      expect(operations.length).toBe(0);
      expect(workingOrder).toEqual(['youtube-1']);
    });

    it('should handle completely reversed playlist', async () => {
      const currentOrder = ['youtube-4', 'youtube-3', 'youtube-2', 'youtube-1'];
      const targetOrder = ['youtube-1', 'youtube-2', 'youtube-3', 'youtube-4'];

      const operations: Array<{ videoId: string; fromPosition: number; toPosition: number }> = [];
      const workingOrder = [...currentOrder];

      for (let finalPosition = 0; finalPosition < targetOrder.length; finalPosition++) {
        const videoId = targetOrder[finalPosition];
        const currentPosition = workingOrder.indexOf(videoId);

        if (currentPosition !== finalPosition) {
          operations.push({
            videoId: videoId,
            fromPosition: currentPosition,
            toPosition: finalPosition
          });

          workingOrder.splice(currentPosition, 1);
          workingOrder.splice(finalPosition, 0, videoId);
        }
      }

      // Should generate operations to reverse the order
      expect(operations.length).toBeGreaterThan(0);
      expect(workingOrder).toEqual(targetOrder);
    });
  });
});