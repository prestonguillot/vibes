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

### 4. Security Audit
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
- [x] Review authentication and authorization patterns
- [x] Check for sensitive data exposure (error messages sanitized in production)
- [x] Audit token storage and handling (HttpOnly, SameSite=strict cookies)
- [ ] Review input validation and sanitization
- [x] Check for common web vulnerabilities (CSRF protection added)
- [x] Verify secure cookie configurations (secure flag in production, SameSite=strict)
- [x] Review error messages for information leakage (env-aware error details)

### 5. Add Test Suite
- [ ] Discuss and choose testing framework (TBD)
- [ ] Set up test suite infrastructure
- [ ] Write initial tests

### 6. Build and Work on Behavior Bugs List
- [ ] Identify behavior bugs
- [ ] Prioritize bugs
- [ ] Fix bugs systematically

### 7. Build and Work on Styling Bugs List
- [ ] Identify styling issues
- [ ] Prioritize styling fixes
- [ ] Apply fixes

## Current Status
Working on: Tasks 1, 2 & 3 Complete ✅ - Ready for Task 4 (Security Audit)
