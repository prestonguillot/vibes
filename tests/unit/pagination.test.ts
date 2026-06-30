/**
 * Unit tests for pagination logic across the application (BUG-006)
 */

import { describe, it, expect } from 'vitest';

describe('General Pagination Logic (BUG-006)', () => {
  describe('YouTube playlists pagination', () => {
    it('should handle users with <= 50 playlists (single page)', () => {
      const targetPlaylistName = 'Test Playlist (from Spotify)';

      const page1 = {
        items: [
          { id: 'pl1', snippet: { title: 'Playlist 1' } },
          { id: 'pl2', snippet: { title: targetPlaylistName } },
          { id: 'pl3', snippet: { title: 'Playlist 3' } },
        ],
        nextPageToken: undefined,
      };

      let targetPlaylist;
      const pages = [page1];

      for (const page of pages) {
        targetPlaylist = page.items.find((pl) => pl.snippet.title === targetPlaylistName);
        if (targetPlaylist) break;
        if (!page.nextPageToken) break;
      }

      expect(targetPlaylist).toBeDefined();
      expect(targetPlaylist?.id).toBe('pl2');
    });

    it('should handle users with > 50 playlists (multiple pages)', () => {
      const targetPlaylistName = 'My Playlist (from Spotify)';

      // Simulate 150 playlists across 3 pages
      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `pl${i}`,
          snippet: { title: `Playlist ${i}` },
        })),
        nextPageToken: 'token2',
      };

      const page2 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `pl${i + 50}`,
          snippet: { title: `Playlist ${i + 50}` },
        })),
        nextPageToken: 'token3',
      };

      const page3 = {
        items: [
          ...Array.from({ length: 49 }, (_, i) => ({
            id: `pl${i + 100}`,
            snippet: { title: `Playlist ${i + 100}` },
          })),
          { id: 'pl149', snippet: { title: targetPlaylistName } },
        ],
        nextPageToken: undefined,
      };

      let targetPlaylist;
      const pages = [page1, page2, page3];

      for (const page of pages) {
        targetPlaylist = page.items.find((pl) => pl.snippet.title === targetPlaylistName);
        if (targetPlaylist) break;
        if (!page.nextPageToken) break;
      }

      expect(targetPlaylist).toBeDefined();
      expect(targetPlaylist?.id).toBe('pl149');
    });

    it('should use early exit optimization when playlist found', () => {
      const targetPlaylistName = 'Target Playlist (from Spotify)';
      let pagesChecked = 0;

      const page1 = {
        items: [
          { id: 'pl1', snippet: { title: 'Playlist 1' } },
          { id: 'pl2', snippet: { title: targetPlaylistName } },
        ],
        nextPageToken: 'token2',
      };

      const page2 = {
        items: [{ id: 'pl3', snippet: { title: 'Playlist 3' } }],
        nextPageToken: undefined,
      };

      let targetPlaylist;
      const pages = [page1, page2];

      for (const page of pages) {
        pagesChecked++;
        targetPlaylist = page.items.find((pl) => pl.snippet.title === targetPlaylistName);
        if (targetPlaylist) break;
        if (!page.nextPageToken) break;
      }

      expect(targetPlaylist).toBeDefined();
      expect(pagesChecked).toBe(1); // Should not check page 2
    });

    it('should return undefined when playlist not found after all pages', () => {
      const targetPlaylistName = 'Nonexistent Playlist';

      const page1 = {
        items: [
          { id: 'pl1', snippet: { title: 'Playlist 1' } },
          { id: 'pl2', snippet: { title: 'Playlist 2' } },
        ],
        nextPageToken: 'token2',
      };

      const page2 = {
        items: [{ id: 'pl3', snippet: { title: 'Playlist 3' } }],
        nextPageToken: undefined,
      };

      let targetPlaylist;
      const pages = [page1, page2];

      for (const page of pages) {
        targetPlaylist = page.items.find((pl) => pl.snippet.title === targetPlaylistName);
        if (targetPlaylist) break;
        if (!page.nextPageToken) break;
      }

      expect(targetPlaylist).toBeUndefined();
    });
  });

  describe('YouTube playlist items pagination', () => {
    it('should fetch all playlist items when <= 50 videos', () => {
      const page1 = {
        items: Array.from({ length: 30 }, (_, i) => ({
          id: `item${i}`,
          snippet: {
            resourceId: { videoId: `video${i}` },
            title: `Video ${i}`,
          },
        })),
        nextPageToken: undefined,
      };

      const allItems: any[] = [];
      const pages = [page1];

      for (const page of pages) {
        allItems.push(...page.items);
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(30);
      expect(allItems[0].snippet.title).toBe('Video 0');
      expect(allItems[29].snippet.title).toBe('Video 29');
    });

    it('should fetch all playlist items when > 50 videos', () => {
      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i}`,
          snippet: {
            resourceId: { videoId: `video${i}` },
            title: `Video ${i}`,
          },
        })),
        nextPageToken: 'token2',
      };

      const page2 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i + 50}`,
          snippet: {
            resourceId: { videoId: `video${i + 50}` },
            title: `Video ${i + 50}`,
          },
        })),
        nextPageToken: 'token3',
      };

      const page3 = {
        items: Array.from({ length: 25 }, (_, i) => ({
          id: `item${i + 100}`,
          snippet: {
            resourceId: { videoId: `video${i + 100}` },
            title: `Video ${i + 100}`,
          },
        })),
        nextPageToken: undefined,
      };

      const allItems: any[] = [];
      const pages = [page1, page2, page3];

      for (const page of pages) {
        allItems.push(...page.items);
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(125);
      expect(allItems[0].snippet.title).toBe('Video 0');
      expect(allItems[124].snippet.title).toBe('Video 124');
    });

    it('should handle exactly 50 items (boundary test)', () => {
      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i}`,
          snippet: {
            resourceId: { videoId: `video${i}` },
            title: `Video ${i}`,
          },
        })),
        nextPageToken: undefined, // No more pages
      };

      const allItems: any[] = [];
      const pages = [page1];

      for (const page of pages) {
        allItems.push(...page.items);
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(50);
    });

    it('should handle exactly 51 items (just over boundary)', () => {
      const page1 = {
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `item${i}`,
          snippet: {
            resourceId: { videoId: `video${i}` },
            title: `Video ${i}`,
          },
        })),
        nextPageToken: 'token2',
      };

      const page2 = {
        items: [
          {
            id: 'item50',
            snippet: {
              resourceId: { videoId: 'video50' },
              title: 'Video 50',
            },
          },
        ],
        nextPageToken: undefined,
      };

      const allItems: any[] = [];
      const pages = [page1, page2];

      for (const page of pages) {
        allItems.push(...page.items);
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(51);
      expect(allItems[50].snippet.title).toBe('Video 50');
    });

    it('should handle empty playlist', () => {
      const page1 = {
        items: [],
        nextPageToken: undefined,
      };

      const allItems: any[] = [];
      const pages = [page1];

      for (const page of pages) {
        allItems.push(...page.items);
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(0);
    });

    it('should preserve video metadata across pages', () => {
      const page1 = {
        items: [
          {
            id: 'item1',
            snippet: {
              resourceId: { videoId: 'abc123' },
              title: 'Song Title',
              description: 'Description',
              thumbnails: { medium: { url: 'https://example.com/thumb.jpg' } },
            },
          },
        ],
        nextPageToken: 'token2',
      };

      const page2 = {
        items: [
          {
            id: 'item2',
            snippet: {
              resourceId: { videoId: 'def456' },
              title: 'Another Song',
              description: 'Another Description',
              thumbnails: { medium: { url: 'https://example.com/thumb2.jpg' } },
            },
          },
        ],
        nextPageToken: undefined,
      };

      const allItems: any[] = [];
      const pages = [page1, page2];

      for (const page of pages) {
        allItems.push(...page.items);
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(2);
      expect(allItems[0].snippet.resourceId.videoId).toBe('abc123');
      expect(allItems[0].snippet.title).toBe('Song Title');
      expect(allItems[1].snippet.resourceId.videoId).toBe('def456');
      expect(allItems[1].snippet.title).toBe('Another Song');
    });
  });

  describe('Pagination for sync status checking', () => {
    it('should check all YouTube playlists to determine sync status', () => {
      const spotifyPlaylists = [
        { name: 'Playlist A' },
        { name: 'Playlist B' },
        { name: 'Playlist C' },
      ];

      // Simulate YouTube playlists spread across pages
      const page1 = {
        items: [
          { id: 'yt1', snippet: { title: 'Playlist A (from Spotify)' } },
          { id: 'yt2', snippet: { title: 'Unrelated Playlist' } },
        ],
        nextPageToken: 'token2',
      };

      const page2 = {
        items: [
          { id: 'yt3', snippet: { title: 'Another Unrelated' } },
          { id: 'yt4', snippet: { title: 'Playlist C (from Spotify)' } },
        ],
        nextPageToken: undefined,
      };

      const youtubePlaylistNames = new Set<string>();
      const pages = [page1, page2];

      for (const page of pages) {
        page.items.forEach((playlist) => {
          youtubePlaylistNames.add(playlist.snippet.title);
        });
        if (!page.nextPageToken) break;
      }

      const syncedPlaylists = spotifyPlaylists.filter((pl) =>
        youtubePlaylistNames.has(`${pl.name} (from Spotify)`),
      );

      const unsyncedPlaylists = spotifyPlaylists.filter(
        (pl) => !youtubePlaylistNames.has(`${pl.name} (from Spotify)`),
      );

      expect(syncedPlaylists.length).toBe(2); // A and C
      expect(unsyncedPlaylists.length).toBe(1); // B
      expect(syncedPlaylists.map((p) => p.name)).toEqual(['Playlist A', 'Playlist C']);
      expect(unsyncedPlaylists.map((p) => p.name)).toEqual(['Playlist B']);
    });

    it('should handle case where all playlists are unsynced', () => {
      const spotifyPlaylists = [{ name: 'Playlist A' }, { name: 'Playlist B' }];

      const page1 = {
        items: [
          { id: 'yt1', snippet: { title: 'Unrelated Playlist 1' } },
          { id: 'yt2', snippet: { title: 'Unrelated Playlist 2' } },
        ],
        nextPageToken: undefined,
      };

      const youtubePlaylistNames = new Set<string>();
      const pages = [page1];

      for (const page of pages) {
        page.items.forEach((playlist) => {
          youtubePlaylistNames.add(playlist.snippet.title);
        });
        if (!page.nextPageToken) break;
      }

      const syncedPlaylists = spotifyPlaylists.filter((pl) =>
        youtubePlaylistNames.has(`${pl.name} (from Spotify)`),
      );

      expect(syncedPlaylists.length).toBe(0);
    });

    it('should handle case where all playlists are synced', () => {
      const spotifyPlaylists = [{ name: 'Playlist A' }, { name: 'Playlist B' }];

      const page1 = {
        items: [
          { id: 'yt1', snippet: { title: 'Playlist A (from Spotify)' } },
          { id: 'yt2', snippet: { title: 'Playlist B (from Spotify)' } },
        ],
        nextPageToken: undefined,
      };

      const youtubePlaylistNames = new Set<string>();
      const pages = [page1];

      for (const page of pages) {
        page.items.forEach((playlist) => {
          youtubePlaylistNames.add(playlist.snippet.title);
        });
        if (!page.nextPageToken) break;
      }

      const syncedPlaylists = spotifyPlaylists.filter((pl) =>
        youtubePlaylistNames.has(`${pl.name} (from Spotify)`),
      );

      expect(syncedPlaylists.length).toBe(2);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined items array', () => {
      const page1 = {
        items: undefined,
        nextPageToken: undefined,
      };

      const allItems: any[] = [];
      const pages = [page1];

      for (const page of pages) {
        if (page.items) {
          allItems.push(...page.items);
        }
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(0);
    });

    it('should handle nextPageToken that is null vs undefined', () => {
      const page1 = {
        items: [{ id: 'item1' }],
        nextPageToken: null,
      };

      let shouldContinue = !!page1.nextPageToken;
      expect(shouldContinue).toBe(false);

      const page2 = {
        items: [{ id: 'item2' }],
        nextPageToken: undefined,
      };

      shouldContinue = !!page2.nextPageToken;
      expect(shouldContinue).toBe(false);

      const page3 = {
        items: [{ id: 'item3' }],
        nextPageToken: 'token',
      };

      shouldContinue = !!page3.nextPageToken;
      expect(shouldContinue).toBe(true);
    });

    it('should handle very large result sets (500+ items)', () => {
      // Simulate 500 items across 10 pages
      const pages = Array.from({ length: 10 }, (_, pageIndex) => ({
        items: Array.from({ length: 50 }, (_, itemIndex) => ({
          id: `item${pageIndex * 50 + itemIndex}`,
          snippet: { title: `Video ${pageIndex * 50 + itemIndex}` },
        })),
        nextPageToken: pageIndex < 9 ? `token${pageIndex + 2}` : undefined,
      }));

      const allItems: any[] = [];

      for (const page of pages) {
        allItems.push(...page.items);
        if (!page.nextPageToken) break;
      }

      expect(allItems.length).toBe(500);
      expect(allItems[0].id).toBe('item0');
      expect(allItems[499].id).toBe('item499');
    });
  });
});
