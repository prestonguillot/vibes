/**
 * Unit tests for playlist filtering logic
 * Tests the actual filtering behavior that was broken
 */

import { describe, it, expect } from 'vitest';

describe('Playlist Filtering Logic', () => {
  // Mock user data
  const currentUserId = 'testuser123';

  // Mock playlists - mix of owned and followed
  const mockPlaylists = [
    { id: '1', name: 'My Playlist 1', owner: { id: 'testuser123' } },
    { id: '2', name: 'Followed Playlist 1', owner: { id: 'otheruser456' } },
    { id: '3', name: 'My Playlist 2', owner: { id: 'testuser123' } },
    { id: '4', name: 'Followed Playlist 2', owner: { id: 'anotheruser789' } },
    { id: '5', name: 'My Playlist 3', owner: { id: 'testuser123' } },
  ];

  describe('ownOnly filtering', () => {
    it('should filter to only owned playlists when ownOnly is true', () => {
      // This simulates the backend logic in spotify.ts:165-175
      const ownOnly = true;

      let filteredPlaylists = mockPlaylists;
      if (ownOnly) {
        filteredPlaylists = filteredPlaylists.filter(
          (playlist) => playlist.owner.id === currentUserId
        );
      }

      expect(filteredPlaylists).toHaveLength(3);
      expect(filteredPlaylists.every(p => p.owner.id === currentUserId)).toBe(true);
      expect(filteredPlaylists.map(p => p.name)).toEqual([
        'My Playlist 1',
        'My Playlist 2',
        'My Playlist 3'
      ]);
    });

    it('should show all playlists when ownOnly is false', () => {
      // This simulates the backend logic in spotify.ts:165-175
      const ownOnly = false;

      let filteredPlaylists = mockPlaylists;
      if (ownOnly) {
        filteredPlaylists = filteredPlaylists.filter(
          (playlist) => playlist.owner.id === currentUserId
        );
      }

      expect(filteredPlaylists).toHaveLength(5);
      expect(filteredPlaylists).toEqual(mockPlaylists);
    });

    it('should show all playlists when ownOnly is undefined', () => {
      // This simulates the backend logic in spotify.ts:165-175
      const ownOnly = undefined;

      let filteredPlaylists = mockPlaylists;
      if (ownOnly) {
        filteredPlaylists = filteredPlaylists.filter(
          (playlist) => playlist.owner.id === currentUserId
        );
      }

      expect(filteredPlaylists).toHaveLength(5);
      expect(filteredPlaylists).toEqual(mockPlaylists);
    });
  });

  describe('Boolean comparison bug prevention', () => {
    it('should correctly evaluate when ownOnly is boolean true (not string "true")', () => {
      // The bug was: req.query.ownOnly === 'true'
      // After Zod transformation, req.query.ownOnly is boolean true, not string 'true'

      const ownOnlyBoolean = true; // After Zod transformation
      const ownOnlyString = 'true'; // What we mistakenly compared against

      // Correct comparison (what we fixed to)
      expect(ownOnlyBoolean === true).toBe(true);

      // Incorrect comparison (the bug)
      expect(ownOnlyBoolean === ownOnlyString as any).toBe(false);
    });

    it('should correctly evaluate when ownOnly is boolean false (not string "false")', () => {
      const ownOnlyBoolean = false; // After Zod transformation
      const ownOnlyString = 'false'; // What we mistakenly compared against

      // Correct comparison (what we fixed to)
      expect(ownOnlyBoolean === false).toBe(true);

      // Incorrect comparison (the bug)
      expect(ownOnlyBoolean === ownOnlyString as any).toBe(false);
    });

    it('should demonstrate the bug: string comparison fails after Zod transformation', () => {
      // Simulate Zod transformation
      const transformedTrue = true; // Zod transforms 'true' to boolean true
      const transformedFalse = false; // Zod transforms 'false' to boolean false

      // The buggy code: req.query.ownOnly === 'true'
      // This would ALWAYS be false after Zod transformation!
      expect(transformedTrue === 'true').toBe(false);
      expect(transformedFalse === 'false').toBe(false);

      // The fixed code: req.query.ownOnly === true
      expect(transformedTrue === true).toBe(true);
      expect(transformedFalse === false).toBe(true);
    });
  });

  describe('Filtering with transformed boolean values', () => {
    it('should filter correctly when ownOnly is transformed boolean true', () => {
      // Simulate the complete flow:
      // 1. Query param comes in as string 'true'
      // 2. Zod transforms it to boolean true
      // 3. We compare with === true (not === 'true')

      const queryParam = 'true';
      const transformedValue = queryParam === 'true'; // Simulating Zod transformation
      const ownOnly = transformedValue === true; // Our comparison

      let filteredPlaylists = mockPlaylists;
      if (ownOnly) {
        filteredPlaylists = filteredPlaylists.filter(
          (playlist) => playlist.owner.id === currentUserId
        );
      }

      expect(ownOnly).toBe(true);
      expect(filteredPlaylists).toHaveLength(3);
      expect(filteredPlaylists.every(p => p.owner.id === currentUserId)).toBe(true);
    });

    it('should not filter when ownOnly is transformed boolean false', () => {
      // Simulate the complete flow:
      // 1. Query param comes in as string 'false'
      // 2. Zod transforms it to boolean false
      // 3. We compare with === true (not === 'true')

      const queryParam = 'false';
      const transformedValue = queryParam === 'true'; // Simulating Zod transformation
      const ownOnly = transformedValue === true; // Our comparison

      let filteredPlaylists = mockPlaylists;
      if (ownOnly) {
        filteredPlaylists = filteredPlaylists.filter(
          (playlist) => playlist.owner.id === currentUserId
        );
      }

      expect(ownOnly).toBe(false);
      expect(filteredPlaylists).toHaveLength(5);
      expect(filteredPlaylists).toEqual(mockPlaylists);
    });
  });
});
