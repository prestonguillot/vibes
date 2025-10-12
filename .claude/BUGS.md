# Behavior Bugs List

## Priority: CRITICAL

### BUG-001: Playlist tracks with null track.id crash the app
**Location**: `src/routes/playlistDetails.ts:73-81`
**Error**: `TypeError: Cannot read properties of null (reading 'id')`
**Description**: When a Spotify playlist contains a track where `item.track` is null (e.g., deleted/unavailable tracks), the app crashes because we try to access `item.track.id` without null checking.
**Evidence**: Found in server logs - "Error fetching playlist details | {"playlistId":"6XcippdSzht5IW50taCB0r"}"
**Fix**: Add null check for `item.track` before accessing its properties
```typescript
const spotifyTracks = spotifyPlaylistData.body.tracks.items
  .filter((item: any) => item.track !== null) // Filter out null tracks
  .map((item: any) => ({
    id: item.track.id,
    // ... rest of mapping
  }));
```

### BUG-002: Missing `loading` parameter in connection-button template
**Location**: `views/partials/connection-button.ejs:7`, `src/server.ts:124-144`
**Error**: `ReferenceError: loading is not defined`
**Description**: The connection-button.ejs template expects a `loading` parameter, but the endpoints at `/api/status/spotify/button` and `/api/status/youtube/button` don't pass it.
**Evidence**: Multiple ReferenceError occurrences in server logs
**Fix**: Add `loading: false` parameter to both endpoints in src/server.ts (lines 128 and 139)

## Priority: HIGH

### BUG-003: Video replacement fails with "Invalid playlist item position"
**Location**: `src/routes/sync.ts:536` (reorderExistingTracks function)
**Error**: `GaxiosError: Invalid playlist item position`
**Description**: When reordering tracks in a YouTube playlist, the YouTube API returns a 400 error for invalid positions. This suggests the position calculation or the reordering logic has issues.
**Evidence**: Found in server logs - "Error reordering track | {"trackName":"I'm Bout It, Bout It","targetPosition":7}"
**Fix**: Review the reorderExistingTracks logic in sync.ts to ensure positions are calculated correctly and within bounds

### BUG-004: Video not found in playlist during replacement
**Location**: `src/routes/playlistDetails.ts:654-665`
**Error**: Video not found in playlist
**Description**: When attempting to replace a video, the app sometimes can't find the current video in the YouTube playlist, even though it should exist. This could be due to:
- Pagination issues (only fetching first 50 items)
- Timing/race conditions
- Stale playlist data
**Evidence**: Multiple "Video not found in playlist" errors in logs
**Fix**:
1. Implement pagination to fetch all playlist items (not just first 50)
2. Add retry logic with playlist refresh
3. Improve error message to help user understand the issue

### BUG-005: Spotify API 502 errors not handled gracefully
**Location**: `src/routes/spotify.ts` (playlists endpoint)
**Error**: `WebapiRegularError: An error occurred while communicating with Spotify's Web API` (502 Bad Gateway)
**Description**: When Spotify's API returns a 502 error (their infrastructure issue), the app shows a generic 500 error instead of a user-friendly message suggesting retry.
**Evidence**: Multiple 502 errors in logs from Spotify API
**Fix**: Add specific error handling for 502/503 errors with retry logic and user-friendly messaging

## Priority: MEDIUM

### BUG-006: Pagination limit of 50 items
**Location**: Multiple locations
- `src/routes/playlistDetails.ts:92` (YouTube playlists)
- `src/routes/playlistDetails.ts:108` (YouTube playlist items)
- `src/routes/playlistDetails.ts:647` (YouTube playlist items for replacement)
**Description**: All API calls use `maxResults: 50`, which means:
- Users with >50 playlists won't see all of them
- Playlists with >50 tracks will be incomplete
- Video replacement fails for tracks beyond position 50
**Fix**: Implement pagination loops to fetch all items:
```typescript
let allItems = [];
let nextPageToken = undefined;
do {
  const response = await api.list({ ..., pageToken: nextPageToken });
  allItems.push(...response.data.items);
  nextPageToken = response.data.nextPageToken;
} while (nextPageToken);
```

### BUG-007: Missing details parameter in error templates
**Location**: `src/routes/playlistDetails.ts:53-57`
**Description**: Error message rendering without `details` parameter, but the error-message.ejs template might expect it based on other usages.
**Fix**: Check error-message.ejs template requirements and ensure all renders pass required parameters consistently

## Priority: LOW

### BUG-008: Cache headers inconsistency
**Location**: Various routes
**Description**: Different endpoints use different cache strategies:
- `/api/playlistDetails/playlist/:id` - 10 minutes (600s)
- `/auth/spotify/playlists` - 30 minutes (1800s)
There's no clear caching policy documented.
**Fix**: Document caching strategy and ensure consistency across similar endpoints

### BUG-009: No loading states during long operations
**Description**: Playlist sync and detail fetching can take several seconds, but there's no loading spinner or progress indication for these operations (only for connection status).
**Fix**: Add loading states using HTMX indicators for long-running operations

## Potential Issues (Needs Investigation)

### INVESTIGATE-001: Race conditions in SSE progress updates
**Location**: `src/routes/progress.ts`, `src/routes/sync.ts`
**Description**: Multiple sync operations for the same playlist could interfere with each other's progress updates.
**Investigation needed**: Test concurrent sync operations for the same playlist

### INVESTIGATE-002: Token refresh handling
**Description**: No explicit token refresh logic visible for Spotify/YouTube tokens. Relying on SDK auto-refresh, but errors suggest it might not always work.
**Investigation needed**: Review token expiration handling and add explicit refresh logic if needed

### INVESTIGATE-003: CSRF token rotation
**Location**: `src/utils/csrf.ts`
**Description**: CSRF tokens don't appear to rotate after use, which could be a security concern for long sessions.
**Investigation needed**: Review CSRF token lifecycle and consider implementing rotation

## Summary

- **Critical**: 2 bugs (crashes/errors)
- **High**: 3 bugs (failed operations)
- **Medium**: 2 bugs (incomplete functionality)
- **Low**: 2 bugs (UX improvements)
- **Investigate**: 3 items (potential issues)

**Total**: 12 items
