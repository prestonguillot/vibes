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
  - [x] Unit tests for validation schemas (13 tests passing)
  - [x] Integration tests for actual routes (5 tests passing)
  - [x] All 18 tests passing ✅

### 6. TypeScript Type Safety Audit
- [ ] Audit validation middleware for proper type inference
  - [ ] Remove `as any` casts from validation.ts
  - [ ] Implement proper generic typing for validated request objects
  - [ ] Ensure Zod schema transformations are properly typed
- [ ] Review Express request/response typing
  - [ ] Check for unsafe `any` types in route handlers
  - [ ] Add proper types for middleware that modifies req/res
  - [ ] Type OAuth token structures properly
- [ ] Audit external API response types
  - [ ] Add proper types for Spotify API responses
  - [ ] Add proper types for YouTube API responses
  - [ ] Replace `any` with proper interfaces/types
- [ ] Enable stricter TypeScript compiler options
  - [ ] Consider enabling `strict` mode
  - [ ] Consider enabling `noImplicitAny`
  - [ ] Review and fix any new errors that surface

### 7. Build and Work on Behavior Bugs List
- [x] Identify behavior bugs
  - [x] Created BUGS.md with 12 identified issues
  - [x] 2 Critical, 3 High, 2 Medium, 2 Low priority bugs
  - [x] 3 items for further investigation
- [x] Fix critical bugs
  - [x] BUG-001: Fixed null track crash by adding filter for deleted/unavailable tracks
  - [x] BUG-002: Confirmed loading parameter already present (was fixed previously)
- [ ] Fix high priority bugs (BUG-003 through BUG-005)
- [ ] Fix medium priority bugs (BUG-006 through BUG-007)
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
Working on: Task 5 (Add Test Suite) - Writing initial tests
