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
- [ ] **Issue: Remove Hyperscript dependency**
  - [ ] Replace playlist expand/collapse with HTMX + CSS
  - [ ] Replace video selection state management with HTMX patterns
- [ ] **Issue: Simplify client-side state management**
  - [ ] Move batch size selection to query parameter or hidden form field
  - [ ] Remove `js:` usage in hx-vals where possible

### 3. Explicitly Audit server.ts
- [ ] Review server configuration
- [ ] Check middleware setup
- [ ] Verify routing patterns
- [ ] Assess error handling

### 4. Security Audit
- [ ] Review authentication and authorization patterns
- [ ] Check for sensitive data exposure
- [ ] Audit token storage and handling
- [ ] Review input validation and sanitization
- [ ] Check for common web vulnerabilities (XSS, CSRF, etc.)
- [ ] Verify secure cookie configurations
- [ ] Review error messages for information leakage

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
Working on: Tasks 1 & 2 Complete ✅ - Ready for Task 3 (server.ts Audit)
