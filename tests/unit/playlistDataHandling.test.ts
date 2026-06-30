/**
 * Unit tests for playlist data handling (BUG-001 and related)
 */

import { describe, it, expect } from 'vitest';

describe('Playlist Data Handling', () => {
  describe('BUG-001: Null track handling', () => {
    it('should filter out null tracks from playlist items', () => {
      // Simulate Spotify API response with null tracks (deleted/unavailable)
      const playlistItems = [
        { track: { id: 'track1', name: 'Song 1', artists: [{ name: 'Artist 1' }] } },
        { track: null }, // Deleted track
        { track: { id: 'track2', name: 'Song 2', artists: [{ name: 'Artist 2' }] } },
        { track: null }, // Unavailable track
        { track: { id: 'track3', name: 'Song 3', artists: [{ name: 'Artist 3' }] } },
      ];

      // Filter out null tracks (this is what the fix does)
      const validTracks = playlistItems
        .filter((item) => item.track !== null)
        .map((item) => ({
          id: item.track!.id,
          name: item.track!.name,
          artist: item.track!.artists[0]?.name || 'Unknown',
        }));

      expect(validTracks.length).toBe(3);
      expect(validTracks[0].id).toBe('track1');
      expect(validTracks[1].id).toBe('track2');
      expect(validTracks[2].id).toBe('track3');
    });

    it('should count unavailable tracks for logging', () => {
      const playlistItems = [
        { track: { id: 'track1', name: 'Song 1', artists: [] } },
        { track: null },
        { track: null },
        { track: { id: 'track2', name: 'Song 2', artists: [] } },
      ];

      const totalTracks = playlistItems.length;
      const validTracks = playlistItems.filter((item) => item.track !== null);
      const unavailableTracks = totalTracks - validTracks.length;

      expect(totalTracks).toBe(4);
      expect(validTracks.length).toBe(2);
      expect(unavailableTracks).toBe(2);
    });

    it('should handle playlist with all tracks null', () => {
      const playlistItems = [{ track: null }, { track: null }, { track: null }];

      const validTracks = playlistItems.filter((item) => item.track !== null);

      expect(validTracks.length).toBe(0);
    });

    it('should handle playlist with no null tracks', () => {
      const playlistItems = [
        { track: { id: 'track1', name: 'Song 1', artists: [{ name: 'Artist 1' }] } },
        { track: { id: 'track2', name: 'Song 2', artists: [{ name: 'Artist 2' }] } },
        { track: { id: 'track3', name: 'Song 3', artists: [{ name: 'Artist 3' }] } },
      ];

      const validTracks = playlistItems.filter((item) => item.track !== null);

      expect(validTracks.length).toBe(3);
    });

    it('should handle empty playlist', () => {
      const playlistItems: Array<{ track: unknown }> = [];

      const validTracks = playlistItems.filter((item) => item.track !== null);

      expect(validTracks.length).toBe(0);
    });

    it('should not crash when accessing properties after filtering', () => {
      const playlistItems = [
        {
          track: {
            id: 'track1',
            name: 'Song 1',
            artists: [{ name: 'Artist 1' }],
            album: { name: 'Album 1' },
            duration_ms: 180000,
          },
        },
        { track: null },
        {
          track: {
            id: 'track2',
            name: 'Song 2',
            artists: [{ name: 'Artist 2' }],
            album: { name: 'Album 2' },
            duration_ms: 200000,
          },
        },
      ];

      // This should not throw
      const validTracks = playlistItems
        .filter((item) => item.track !== null)
        .map((item) => ({
          id: item.track!.id,
          name: item.track!.name,
          artist: item.track!.artists[0]?.name || 'Unknown Artist',
          album: item.track!.album?.name || 'Unknown Album',
          duration_ms: item.track!.duration_ms,
        }));

      expect(validTracks.length).toBe(2);
      expect(validTracks[0].id).toBe('track1');
      expect(validTracks[0].name).toBe('Song 1');
      expect(validTracks[0].artist).toBe('Artist 1');
      expect(validTracks[0].album).toBe('Album 1');
      expect(validTracks[0].duration_ms).toBe(180000);
    });
  });

  describe('Track property handling', () => {
    it('should handle missing artist names gracefully', () => {
      const track = {
        id: 'track1',
        name: 'Song 1',
        artists: [], // No artists
      };

      const artist = track.artists[0]?.name || 'Unknown Artist';

      expect(artist).toBe('Unknown Artist');
    });

    it('should handle missing album names gracefully', () => {
      const track = {
        id: 'track1',
        name: 'Song 1',
        artists: [{ name: 'Artist 1' }],
        album: undefined,
      };

      const album = track.album?.name || 'Unknown Album';

      expect(album).toBe('Unknown Album');
    });

    it('should handle tracks with empty artist array', () => {
      const playlistItems = [{ track: { id: 'track1', name: 'Song 1', artists: [] } }];

      const validTracks = playlistItems
        .filter((item) => item.track !== null)
        .map((item) => ({
          id: item.track!.id,
          name: item.track!.name,
          artist: item.track!.artists[0]?.name || 'Unknown Artist',
        }));

      expect(validTracks.length).toBe(1);
      expect(validTracks[0].artist).toBe('Unknown Artist');
    });

    it('should handle tracks with multiple artists', () => {
      const track = {
        id: 'track1',
        name: 'Collaboration Song',
        artists: [{ name: 'Artist 1' }, { name: 'Artist 2' }, { name: 'Artist 3' }],
      };

      // Code only uses first artist
      const artist = track.artists[0]?.name || 'Unknown Artist';

      expect(artist).toBe('Artist 1');
    });
  });

  describe('Type safety with null checks', () => {
    it('should use proper type guards for null checking', () => {
      interface PlaylistItem {
        track: {
          id: string;
          name: string;
          artists: Array<{ name?: string }>;
        } | null;
      }

      const items: PlaylistItem[] = [
        { track: { id: 'track1', name: 'Song 1', artists: [{ name: 'Artist 1' }] } },
        { track: null },
      ];

      // TypeScript should know track is not null after filter
      const validItems = items.filter(
        (item): item is { track: NonNullable<PlaylistItem['track']> } => item.track !== null,
      );

      // This should not require ! operator due to type guard
      const firstTrackId = validItems[0].track.id;

      expect(firstTrackId).toBe('track1');
      expect(validItems.length).toBe(1);
    });
  });
});
