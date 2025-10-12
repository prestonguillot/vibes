# Vibes - Task List

## Priority Order

### 1. Review Dependencies for HTMX Idiomaticity ✅
- [x] Review non-dev dependencies
  - [x] Check if all dependencies align with HTMX principles (server-side rendering, hypermedia-driven)
  - [x] Identify any unnecessary client-side JavaScript libraries
  - [x] Verify all dependencies are actually being used
- [x] Review dev dependencies
  - [x] Check for any obviously out-of-place dev dependencies
- [x] Remove CORS (unnecessary for same-origin HTMX)
- [x] Add missing TypeScript type definitions (@types/cookie-parser, @types/ejs)

### 2. Review Project Structure for "The HTMX Way"
- [x] Review server-side rendering patterns
  - [x] Ensure proper use of EJS templates
  - [x] Check that HTML is generated server-side
- [x] Audit HTMX attributes usage across templates
  - [x] Verify correct use of hx-* attributes
  - [x] Check event handling patterns
- [x] Review REST endpoint patterns and semantics
  - [x] Ensure proper HTTP methods and status codes
  - [x] Verify RESTful design
- [x] Audit response patterns
  - [x] HTML fragments vs full pages
  - [x] Proper content negotiation
- [x] Fix JSON responses in playlistDetails.ts (replaced with EJS templates)
- [x] Create video-replace-success.ejs template
- [x] **Issue: Remove Hyperscript dependency**
  - [x] Replace playlist expand/collapse with HTMX + CSS (checkbox-based)
  - [x] Replace video selection state management with HTMX patterns (radio buttons + CSS)
  - [x] Replace modal close handler with vanilla JS in videoModal.js
  - [x] Remove Hyperscript script tag from index.ejs
- [x] **Issue: Simplify client-side state management**
  - [x] Move batch size selection to form field with hx-include
  - [x] Remove all `js:` usage in hx-vals

### 3. Explicitly Audit server.ts ✅
- [x] Review server configuration
- [x] Check middleware setup
- [x] Verify routing patterns
- [x] Assess error handling
- [x] **Fixed Issues:**
  - [x] Deleted unused /api/status endpoint (120 lines of dead code)
  - [x] Extracted auth validation helpers to src/utils/authValidation.ts (eliminated ~200 lines of duplication)
  - [x] Added rate limiting middleware (express-rate-limit: 30 req/min for status endpoints)
  - [x] Fixed cookie security (added secure flag for production, changed sameSite 'lax' → 'strict')
  - [x] Added global error handling (404 handler + error middleware with env-aware error details)
  - [x] Replaced all require() with ES imports
  - [x] Improved response logging (replaced res.send monkey-patching with res.on('finish'))
  - [x] Removed unused SESSION_SECRET from .env files

### 4. Security Audit ✅
- [x] **Implemented CSRF Protection**
  - [x] Added signed double-submit cookie pattern
  - [x] CSRF validation middleware on all POST endpoints
  - [x] Lazy-loaded secret from environment
  - [x] Comprehensive debug logging
- [x] **Added Environment Variable Validation**
  - [x] Created src/utils/envValidation.ts with schema-based validation
  - [x] Validates all required variables at startup (7 required, 4 optional)
  - [x] Production-specific checks (SESSION_SECRET, CSRF_SECRET, localhost warnings)
  - [x] Prevents server startup if critical vars are missing
- [x] **Added Rate Limiting**
  - [x] Configurable rate limiting for sync operations (5 req/5min per IP)
  - [x] Default: OFF (enable via ENABLE_RATE_LIMITING=true env var)
  - [x] User-friendly error messages via EJS templates
  - [x] IPv6-compatible implementation
- [x] **Added SSE Connection Cleanup**
  - [x] Automatic SSE connection cleanup on sync completion
  - [x] Automatic SSE connection cleanup on sync error
  - [x] Prevents memory leaks from abandoned connections
- [x] Review authentication and authorization patterns
- [x] Check for sensitive data exposure (error messages sanitized in production)
- [x] Audit token storage and handling (HttpOnly, SameSite=strict cookies)
- [x] **Review input validation and sanitization**
  - [x] Zod-based validation middleware on all routes
  - [x] Request body size limits (10kb) to prevent DoS
  - [x] Strict schema validation for IDs (Spotify, YouTube)
  - [x] User-friendly error messages for validation failures
  - [x] Validation applied to params, query, and body
- [x] Check for common web vulnerabilities (CSRF protection added)
- [x] Verify secure cookie configurations (secure flag in production, SameSite=strict)
- [x] Review error messages for information leakage (env-aware error details)

### 5. Add Test Suite ✅
- [x] Discuss and choose testing framework (Vitest + Supertest)
- [x] Set up test suite infrastructure
  - [x] Created src/app.ts to export Express app separately from server
  - [x] Refactored src/server.ts to use createApp()
  - [x] Configured Vitest with TypeScript path aliases
- [x] Write initial tests (unit & integration with mocked APIs)
  - [x] Unit tests for validation schemas (17 tests)
  - [x] Unit tests for playlist filtering logic (8 tests)
  - [x] Integration tests for actual routes (13 tests)
  - [x] All 38 tests passing ✅
- [x] Fix playlist toggle bug and add test coverage
  - [x] Fixed backend boolean comparison bug (src/routes/spotify.ts:157)
  - [x] Fixed frontend toggle using htmx:configRequest event
  - [x] Removed cache-busting from toggle (only refresh button breaks cache)
  - [x] Added comprehensive tests for filtering behavior
  - [x] Added tests to prevent regression of boolean comparison bug

### 6. TypeScript Type Safety Audit ✅
- [x] Audit validation middleware for proper type inference
  - [x] Added `ValidatedRequest` interface for proper typing
  - [x] Added documentation and examples for using validated requests
  - [x] Fixed ZodError usage (error.issues instead of error.errors)
  - [x] Documented remaining `as any` casts with TODO comments
- [x] Review Express request/response typing
  - [x] Identified 45+ occurrences of `any` in route handlers
  - [x] Added `ValidatedRequest` type for route handlers
  - [x] Typed the spotify.ts playlists route with proper query types
  - [x] Created OAuth token types (SpotifyTokens, YouTubeTokens)
- [x] Audit external API response types
  - [x] Created comprehensive Spotify API types (src/types/spotify.ts)
  - [x] Created comprehensive YouTube API types (src/types/youtube.ts)
  - [x] Added helper types for formatted data
- [x] TypeScript compiler options
  - [x] Confirmed `strict` mode already enabled in tsconfig.json
  - [x] All type errors resolved - TypeScript passes with 0 errors
  - [x] All 38 tests passing

### 7. Build and Work on Behavior Bugs List ✅
- [x] Identify behavior bugs
  - [x] Created BUGS.md with 12 identified issues
  - [x] 2 Critical, 3 High, 2 Medium, 2 Low priority bugs
  - [x] 3 items for further investigation
- [x] Fix critical bugs
  - [x] BUG-001: Fixed null track crash by adding filter for deleted/unavailable tracks (tests: playlistDataHandling.test.ts)
  - [x] BUG-002: Fixed loading parameter in connection buttons (tests: connectionButton.test.ts)
- [x] Fix high priority bugs
  - [x] BUG-003: Fixed playlist reordering with delete+insert strategy and pagination (tests: sync.test.ts)
  - [x] BUG-004: Fixed video not found with pagination for >50 items (tests: playlistDetailsPagination.test.ts)
  - [x] BUG-005: Fixed Spotify API 502/503 errors with specific error handling (spotify.ts:248-278)
- [x] Fix medium priority bugs
  - [x] BUG-006: Implemented pagination everywhere (>50 playlists/videos) (tests: pagination.test.ts)
    - [x] playlistDetails.ts: Finding YouTube playlists (lines 140-159)
    - [x] playlistDetails.ts: Fetching playlist items (lines 166-183)
    - [x] spotify.ts: Checking sync status (lines 177-206)
  - [x] BUG-007: Added consistent error parameters (title, details) to all error messages
    - [x] playlistDetails.ts: Added helpful titles and details to auth errors (lines 82-88, 650-667)
    - [x] playlistDetails.ts: Added details to playlist not found error (line 713)
    - [x] sync.ts: Added helpful titles and details to auth errors (lines 358-380)
    - [x] sync.ts: Added details to no tracks found error (lines 470-475)
- [ ] Fix low priority bugs (BUG-008 through BUG-009)

### 8. Build and Work on Styling Bugs List
- [ ] Identify styling issues
- [ ] Prioritize styling fixes
- [ ] Apply fixes

### 8. Add End-to-End Tests
- [ ] Create separate E2E test suite with real API credentials
- [ ] Test actual Spotify/YouTube API integration
- [ ] Document E2E test setup and requirements

## Current Status
Task 7 (Behavior Bugs) - 🔄 IN PROGRESS
- ✅ Fixed all critical bugs (BUG-001, BUG-002) with comprehensive tests
- ✅ Fixed all high-priority bugs (BUG-003, BUG-004, BUG-005) with comprehensive tests
- ✅ Fixed BUG-006 (pagination) with comprehensive tests
- 📊 Test count: 120 passed, 2 skipped (122 total) - up from 38 at start
- Test files added:
  - tests/unit/oauth.test.ts (20 tests)
  - tests/unit/sync.test.ts (14 tests)
  - tests/unit/playlistDataHandling.test.ts (11 tests)
  - tests/integration/connectionButton.test.ts (10 tests)
  - tests/unit/playlistDetailsPagination.test.ts (13 tests)
  - tests/unit/pagination.test.ts (16 tests)

Remaining: BUG-007, BUG-008, BUG-009 (medium/low priority)
