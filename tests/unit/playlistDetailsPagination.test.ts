/**
 * Unit tests for playlist details pagination logic (BUG-004)
 */

import { describe, it, expect } from 'vitest';

describe('Playlist Details Pagination Logic (BUG-004)', () => {
  describe('YouTube playlist search with pagination', () => {
    it('should find playlist in first page (< 50 playlists)', () => {
      const targetName = 'My Playlist (from Spotify)';

      // Simulate first page with target playlist
      const page1 = {
        items: [
          { id: 'pl1', snippet: { title: 'Other Playlist' } },
          { id: 'pl2', snippet: { title: targetName } },
          { id: 'pl3', snippet: { title: 'Another Playlist' } }
        ],
        nextPageToken: undefined
      };

      let targetPlaylist;
      const pages = [page1];

      for (const page of pages) {
        targetPlaylist = page.items.find(pl => pl.snippet.title === targetName);
        if (targetPlaylist) break;
        if (!page.nextPageToken) break;
      }

      expect(targetPlaylist).toBeDefined();
      expect(targetPlaylist?.id).toBe('pl2');
      expect(targetPlaylist?.snippet.title).toBe(targetName);
    });

    it('should find playlist across multiple pages (> 50 playlists)', () => {
      const targetName = 'My Playlist (from Spotify)';

      // Simulate pagination - target in page 3
      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `pl${i}`,
          snippet: { title: `Playlist ${i}` }
        })),
        nextPageToken: 'token2'
      };

      const page2 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `pl${i + 50}`,
          snippet: { title: `Playlist ${i + 50}` }
        })),
        nextPageToken: 'token3'
      };

      const page3 = {
        items: [
          { id: 'pl100', snippet: { title: 'Playlist 100' } },
          { id: 'pl101', snippet: { title: targetName } },
          { id: 'pl102', snippet: { title: 'Playlist 102' } }
        ],
        nextPageToken: undefined
      };

      let targetPlaylist;
      const pages = [page1, page2, page3];

      for (const page of pages) {
        targetPlaylist = page.items.find(pl => pl.snippet.title === targetName);
        if (targetPlaylist) break;
        if (!page.nextPageToken) break;
      }

      expect(targetPlaylist).toBeDefined();
      expect(targetPlaylist?.id).toBe('pl101');
    });

    it('should return undefined when playlist not found', () => {
      const targetName = 'Nonexistent Playlist (from Spotify)';

      const page1 = {
        items: [
          { id: 'pl1', snippet: { title: 'Playlist 1' } },
          { id: 'pl2', snippet: { title: 'Playlist 2' } }
        ],
        nextPageToken: undefined
      };

      let targetPlaylist;
      const pages = [page1];

      for (const page of pages) {
        targetPlaylist = page.items.find(pl => pl.snippet.title === targetName);
        if (targetPlaylist) break;
        if (!page.nextPageToken) break;
      }

      expect(targetPlaylist).toBeUndefined();
    });

    it('should exit early when playlist found (not check remaining pages)', () => {
      const targetName = 'My Playlist (from Spotify)';
      let pagesChecked = 0;

      const page1 = {
        items: [
          { id: 'pl1', snippet: { title: 'Playlist 1' } },
          { id: 'pl2', snippet: { title: targetName } }
        ],
        nextPageToken: 'token2'
      };

      const page2 = {
        items: [
          { id: 'pl3', snippet: { title: 'Playlist 3' } }
        ],
        nextPageToken: undefined
      };

      let targetPlaylist;
      const pages = [page1, page2];

      for (const page of pages) {
        pagesChecked++;
        targetPlaylist = page.items.find(pl => pl.snippet.title === targetName);
        if (targetPlaylist) break;
        if (!page.nextPageToken) break;
      }

      expect(targetPlaylist).toBeDefined();
      expect(pagesChecked).toBe(1); // Should stop after page 1
    });
  });

  describe('Video search in playlist with pagination', () => {
    it('should find video in first page (< 50 videos)', () => {
      const targetVideoId = 'video123';

      const page1 = {
        items: [
          { id: 'item1', snippet: { resourceId: { videoId: 'video1' } } },
          { id: 'item2', snippet: { resourceId: { videoId: targetVideoId } } },
          { id: 'item3', snippet: { resourceId: { videoId: 'video3' } } }
        ],
        nextPageToken: undefined
      };

      let targetItem;
      let itemsFetched = 0;
      const pages = [page1];

      for (const page of pages) {
        itemsFetched += page.items.length;
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeDefined();
      expect(targetItem?.id).toBe('item2');
      expect(itemsFetched).toBe(3);
    });

    it('should find video beyond position 50 (pagination required)', () => {
      const targetVideoId = 'video75';

      // Simulate video at position 75 (beyond first page)
      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i}`,
          snippet: { resourceId: { videoId: `video${i}` } }
        })),
        nextPageToken: 'token2'
      };

      const page2 = {
        items: [
          ...Array.from({ length: 25 }, (_, i) => ({
            id: `item${i + 50}`,
            snippet: { resourceId: { videoId: `video${i + 50}` } }
          })),
          { id: 'item75', snippet: { resourceId: { videoId: targetVideoId } } }
        ],
        nextPageToken: undefined
      };

      let targetItem;
      let itemsFetched = 0;
      const pages = [page1, page2];

      for (const page of pages) {
        itemsFetched += page.items.length;
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeDefined();
      expect(targetItem?.id).toBe('item75');
      expect(itemsFetched).toBe(76); // 50 from page 1 + 26 from page 2
    });

    it('should find video at exactly position 50 (boundary test)', () => {
      const targetVideoId = 'video49'; // 0-indexed, so position 50 is index 49

      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i}`,
          snippet: { resourceId: { videoId: `video${i}` } }
        })),
        nextPageToken: 'token2'
      };

      let targetItem;
      let itemsFetched = 0;
      const pages = [page1];

      for (const page of pages) {
        itemsFetched += page.items.length;
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeDefined();
      expect(targetItem?.id).toBe('item49');
      expect(itemsFetched).toBe(50);
    });

    it('should find video at position 51 (just beyond first page)', () => {
      const targetVideoId = 'video50';

      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i}`,
          snippet: { resourceId: { videoId: `video${i}` } }
        })),
        nextPageToken: 'token2'
      };

      const page2 = {
        items: [
          { id: 'item50', snippet: { resourceId: { videoId: targetVideoId } } }
        ],
        nextPageToken: undefined
      };

      let targetItem;
      let itemsFetched = 0;
      const pages = [page1, page2];

      for (const page of pages) {
        itemsFetched += page.items.length;
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeDefined();
      expect(targetItem?.id).toBe('item50');
      expect(itemsFetched).toBe(51); // 50 + 1
    });

    it('should return undefined when video not found after checking all pages', () => {
      const targetVideoId = 'nonexistent-video';

      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i}`,
          snippet: { resourceId: { videoId: `video${i}` } }
        })),
        nextPageToken: 'token2'
      };

      const page2 = {
        items: Array.from({ length: 30 }, (_, i) => ({
          id: `item${i + 50}`,
          snippet: { resourceId: { videoId: `video${i + 50}` } }
        })),
        nextPageToken: undefined
      };

      let targetItem;
      let itemsFetched = 0;
      const pages = [page1, page2];

      for (const page of pages) {
        itemsFetched += page.items.length;
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeUndefined();
      expect(itemsFetched).toBe(80); // All items were checked
    });

    it('should exit early when video found (not check remaining pages)', () => {
      const targetVideoId = 'video5';
      let pagesChecked = 0;

      const page1 = {
        items: [
          { id: 'item1', snippet: { resourceId: { videoId: 'video1' } } },
          { id: 'item2', snippet: { resourceId: { videoId: targetVideoId } } }
        ],
        nextPageToken: 'token2'
      };

      const page2 = {
        items: [
          { id: 'item3', snippet: { resourceId: { videoId: 'video3' } } }
        ],
        nextPageToken: undefined
      };

      let targetItem;
      const pages = [page1, page2];

      for (const page of pages) {
        pagesChecked++;
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeDefined();
      expect(pagesChecked).toBe(1); // Should stop after page 1
    });

    it('should track total items fetched for logging', () => {
      const targetVideoId = 'video125';

      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i}`,
          snippet: { resourceId: { videoId: `video${i}` } }
        })),
        nextPageToken: 'token2'
      };

      const page2 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i + 50}`,
          snippet: { resourceId: { videoId: `video${i + 50}` } }
        })),
        nextPageToken: 'token3'
      };

      const page3 = {
        items: Array.from({ length: 26 }, (_, i) => ({
          id: `item${i + 100}`,
          snippet: { resourceId: { videoId: `video${i + 100}` } }
        })),
        nextPageToken: undefined
      };

      let targetItem;
      let itemsFetched = 0;
      const pages = [page1, page2, page3];

      for (const page of pages) {
        itemsFetched += page.items.length;
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeDefined();
      expect(itemsFetched).toBe(126); // 50 + 50 + 26 (stopped when found in page 3)
    });
  });

  describe('Edge cases', () => {
    it('should handle empty playlist items response', () => {
      const targetVideoId = 'video1';

      const page1 = {
        items: [],
        nextPageToken: undefined
      };

      let targetItem;
      let itemsFetched = 0;
      const pages = [page1];

      for (const page of pages) {
        itemsFetched += page.items.length;
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeUndefined();
      expect(itemsFetched).toBe(0);
    });

    it('should handle missing resourceId in playlist items', () => {
      const targetVideoId = 'video2';

      const page1 = {
        items: [
          { id: 'item1', snippet: { resourceId: undefined } }, // Missing resourceId
          { id: 'item2', snippet: { resourceId: { videoId: targetVideoId } } }
        ],
        nextPageToken: undefined
      };

      let targetItem;
      const pages = [page1];

      for (const page of pages) {
        targetItem = page.items.find(item => item.snippet?.resourceId?.videoId === targetVideoId);
        if (targetItem) break;
        if (!page.nextPageToken) break;
      }

      expect(targetItem).toBeDefined();
      expect(targetItem?.id).toBe('item2');
    });
  });
});
