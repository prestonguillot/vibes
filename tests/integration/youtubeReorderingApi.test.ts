import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('YouTube API Reordering Behavior', () => {
  // Simulates how YouTube's playlistItems.update actually behaves
  class MockYouTubePlaylist {
    items: Array<{ id: string; videoId: string; position: number }>;

    constructor(initialItems: Array<{ id: string; videoId: string }>) {
      this.items = initialItems.map((item, index) => ({
        ...item,
        position: index,
      }));
    }

    // Simulates YouTube's position update behavior:
    // When you update a video's position, it removes it from current position
    // and inserts it at the new position, shifting other items
    updatePosition(itemId: string, newPosition: number) {
      const currentIndex = this.items.findIndex((item) => item.id === itemId);
      if (currentIndex === -1) throw new Error('Item not found');

      const item = this.items[currentIndex];

      // Remove from current position
      this.items.splice(currentIndex, 1);

      // Insert at new position
      this.items.splice(newPosition, 0, item);

      // Update all positions
      this.items.forEach((item, index) => {
        item.position = index;
      });
    }

    getOrder(): string[] {
      return this.items.map((item) => item.videoId);
    }
  }

  describe('Tracks 3 and 4 Reversal Issue', () => {
    it('should correctly reorder tracks 1,2,4,3 to 1,2,3,4 when processing in forward order', () => {
      // Initial state: tracks are in order [1, 2, 4, 3]
      const playlist = new MockYouTubePlaylist([
        { id: 'item-1', videoId: 'track-1' },
        { id: 'item-2', videoId: 'track-2' },
        { id: 'item-4', videoId: 'track-4' },
        { id: 'item-3', videoId: 'track-3' },
      ]);

      // Target order: [1, 2, 3, 4]
      const targetOrder = ['track-1', 'track-2', 'track-3', 'track-4'];

      // Calculate operations using forward processing (position 0 to end)
      const operations: Array<{ itemId: string; fromPos: number; toPos: number }> = [];

      for (let targetPos = 0; targetPos < targetOrder.length; targetPos++) {
        const videoId = targetOrder[targetPos];
        const currentPos = playlist.getOrder().indexOf(videoId);

        if (currentPos !== targetPos) {
          const item = playlist.items.find((i) => i.videoId === videoId);
          if (item) {
            operations.push({
              itemId: item.id,
              fromPos: currentPos,
              toPos: targetPos,
            });

            // Simulate the position update
            playlist.updatePosition(item.id, targetPos);
          }
        }
      }

      // Check the operations
      expect(operations).toHaveLength(1);
      expect(operations[0]).toEqual({
        itemId: 'item-3',
        fromPos: 3,
        toPos: 2,
      });

      // PROBLEM: After moving track-3 from position 3 to position 2,
      // track-4 gets shifted from position 2 to position 3!

      const finalOrder = playlist.getOrder();

      // This will FAIL because track-4 gets shifted
      expect(finalOrder).toEqual(['track-1', 'track-2', 'track-3', 'track-4']);
    });

    it('should demonstrate the problem: track-4 gets shifted when track-3 is moved', () => {
      const playlist = new MockYouTubePlaylist([
        { id: 'item-1', videoId: 'track-1' },
        { id: 'item-2', videoId: 'track-2' },
        { id: 'item-4', videoId: 'track-4' },
        { id: 'item-3', videoId: 'track-3' },
      ]);

      expect(playlist.getOrder()).toEqual(['track-1', 'track-2', 'track-4', 'track-3']);

      // Move track-3 from position 3 to position 2
      playlist.updatePosition('item-3', 2);

      // After this operation, track-4 gets pushed to position 3!
      expect(playlist.getOrder()).toEqual(['track-1', 'track-2', 'track-3', 'track-4']);

      // This actually worked! But only by accident - if we had to move track-4 too,
      // we'd have a problem because its position changed
    });

    it('should show the issue when multiple moves are needed', () => {
      // More complex case: [1, 4, 3, 2] needs to become [1, 2, 3, 4]
      const playlist = new MockYouTubePlaylist([
        { id: 'item-1', videoId: 'track-1' },
        { id: 'item-4', videoId: 'track-4' },
        { id: 'item-3', videoId: 'track-3' },
        { id: 'item-2', videoId: 'track-2' },
      ]);

      const targetOrder = ['track-1', 'track-2', 'track-3', 'track-4'];

      // Process in forward order
      for (let targetPos = 0; targetPos < targetOrder.length; targetPos++) {
        const videoId = targetOrder[targetPos];
        const currentPos = playlist.getOrder().indexOf(videoId);

        if (currentPos !== targetPos) {
          const item = playlist.items.find((i) => i.videoId === videoId);
          if (item) {
            console.log(`Moving ${videoId} from position ${currentPos} to position ${targetPos}`);
            playlist.updatePosition(item.id, targetPos);
            console.log(`After move: ${playlist.getOrder().join(', ')}`);
          }
        }
      }

      const finalOrder = playlist.getOrder();

      // This might not work correctly due to position shifts
      expect(finalOrder).toEqual(['track-1', 'track-2', 'track-3', 'track-4']);
    });
  });

  describe('Solution: Reverse Processing', () => {
    it('should correctly reorder when processing in REVERSE order', () => {
      // Initial state: [1, 4, 3, 2]
      const playlist = new MockYouTubePlaylist([
        { id: 'item-1', videoId: 'track-1' },
        { id: 'item-4', videoId: 'track-4' },
        { id: 'item-3', videoId: 'track-3' },
        { id: 'item-2', videoId: 'track-2' },
      ]);

      const targetOrder = ['track-1', 'track-2', 'track-3', 'track-4'];

      // Process in REVERSE order (from end to start)
      for (let targetPos = targetOrder.length - 1; targetPos >= 0; targetPos--) {
        const videoId = targetOrder[targetPos];
        const currentPos = playlist.getOrder().indexOf(videoId);

        if (currentPos !== targetPos) {
          const item = playlist.items.find((i) => i.videoId === videoId);
          if (item) {
            console.log(`Moving ${videoId} from position ${currentPos} to position ${targetPos}`);
            playlist.updatePosition(item.id, targetPos);
            console.log(`After move: ${playlist.getOrder().join(', ')}`);
          }
        }
      }

      const finalOrder = playlist.getOrder();

      // Processing in reverse should work correctly
      expect(finalOrder).toEqual(['track-1', 'track-2', 'track-3', 'track-4']);
    });
  });
});
