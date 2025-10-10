# HTMX/Hyperscript Refactoring Plan

**Status**: Plan approved by user, implementation not yet started
**Created**: 2025-10-10
**Last Updated**: 2025-10-10

## Overview

This document outlines the plan to refactor the codebase to follow idiomatic HTMX/Hyperscript patterns. The current codebase has several anti-patterns:
- HTML embedded in TypeScript routes (~500 lines)
- Heavy client-side JavaScript (~1,391 lines across 6 files)
- Inline styles instead of CSS classes (~50+ instances)
- Manual DOM manipulation instead of declarative HTMX

## Key Issues Identified

### 1. Excessive HTML Generation in Server Routes (12 instances)

**Problem**: Server-side routes generate large HTML fragments with inline styles, inline event handlers, and complex markup.

**Locations**:
- `src/routes/spotify.ts:107-127` - OAuth error page with inline styles/scripts
- `src/routes/spotify.ts:140` - Error message with inline styles
- `src/routes/spotify.ts:222-299` - Massive playlist item HTML generation (80+ lines per item)
- `src/routes/spotify.ts:309-314` - Playlist container HTML
- `src/routes/spotify.ts:320-328` - Auth error HTML with inline onclick
- `src/routes/youtube.ts:106-126` - OAuth error page (duplicate pattern)
- `src/routes/sync.ts:890-896` - Alert HTML
- `src/routes/sync.ts:1123-1162` - Complex sync feedback HTML
- `src/routes/playlistDetails.ts:303-391` - Large playlist details HTML (90+ lines)
- `src/routes/playlistDetails.ts:404-410` - Error alert
- `src/routes/playlistDetails.ts:445-488` - Video selection modal HTML
- `src/routes/playlistDetails.ts:495-501` - Error alert

**Anti-patterns**:
- Inline `onclick` attributes throughout
- Inline `style` attributes throughout
- Manual HTML string concatenation in TypeScript
- No separation between presentation and logic

### 2. Heavy Client-Side JavaScript (1,391 lines across 6 files)

**Problem**: Extensive client-side JavaScript performing tasks that HTMX/Hyperscript could handle declaratively.

**Files**:
- `public/js/connectionStatus.js` (232 lines) - Manual OAuth UI generation, DOM manipulation
- `public/js/syncFunctionality.js` (590 lines) - Complex HTMX event handling, manual SSE, sessionStorage usage
- `public/js/playlistDetails.js` (265 lines) - Modal creation, manual HTMX ajax calls
- `public/js/syncProgressUpdater.js` (214 lines) - SSE connection management
- `public/js/collapsible.js` (61 lines) - Manual collapsible behavior
- `public/js/alert.js` (29 lines) - Alert dismissal (could use Bootstrap)

**Specific Anti-patterns**:
- `connectionStatus.js:66, 80` - Generating HTML with `onclick` attributes via `innerHTML`
- `syncFunctionality.js:151-165` - Manual DOM manipulation instead of HTMX swaps
- `playlistDetails.js:89-113` - Creating modals with inline styles dynamically
- Manual `htmx.ajax()` calls instead of declarative attributes
- `sessionStorage` usage for state management
- Global function exposure pattern

### 3. Inline Styles Instead of CSS Classes

**Problem**: Many inline styles scattered throughout, both in server-generated HTML and client JS.

**Examples**:
- Modal styles in `playlistDetails.js:89-113`
- Playlist item styles in `spotify.ts:223-298`
- Progress bar styles throughout
- Spinner styles in `views/index.html:108-115`

---

## Refactoring Plan

### Phase 1: Extract HTML Templates from Server Routes (HIGHEST PRIORITY)

**Goal**: Move all HTML generation from TypeScript routes into reusable template partials.

**Steps**:
1. Create `views/partials/` directory for HTML components
2. Extract these templates:
   - `oauth-error.html` - OAuth error pages (spotify.ts:107-127, youtube.ts:106-126)
   - `playlist-item.html` - Individual playlist item (spotify.ts:222-299)
   - `playlist-details.html` - Playlist details view (playlistDetails.ts:303-391)
   - `video-selection-modal.html` - Video picker (playlistDetails.ts:445-488)
   - `sync-feedback.html` - Sync completion alerts (sync.ts:1123-1162)
   - `error-message.html` - Generic error component
3. Create a simple template renderer in `src/utils/templateRenderer.ts`
   - Support variable interpolation
   - Support conditional rendering
   - Support loops for arrays
4. Replace all `.send(\`<div>...\`)` with template rendering calls
5. Move all inline styles to CSS classes in `public/css/style.css`
6. Replace all `onclick` attributes with HTMX attributes (`hx-get`, `hx-post`, etc.)

**Estimated Impact**: Removes ~500 lines of HTML from TypeScript files

---

### Phase 2: Convert Client-Side JavaScript to Declarative HTMX (HIGH PRIORITY)

**Goal**: Replace imperative JavaScript with declarative HTMX attributes and Hyperscript.

#### 2A. Connection Status Management (`connectionStatus.js`)
- Replace OAuth button generation with server-rendered components
- Use HTMX polling (`hx-get` with `hx-trigger="every 30s"`) for status checks
- Use `hx-swap-oob` for out-of-band status updates
- Remove manual innerHTML manipulation
- **Lines saved**: ~200

#### 2B. Sync Functionality (`syncFunctionality.js`)
- Remove manual SSE connection code - use native HTMX SSE extension
- Replace HTMX event listeners with declarative `hx-target`, `hx-swap` attributes
- Remove sessionStorage usage - use server-side state or URL params
- Convert manual DOM manipulation to `hx-swap-oob`
- **Lines saved**: ~400

#### 2C. Playlist Details (`playlistDetails.js`)
- Remove modal creation code - use Bootstrap modals with HTMX
- Replace `htmx.ajax()` calls with declarative `hx-get`, `hx-post` attributes
- Use Hyperscript for simple interactions (expand/collapse)
- Remove global function exposure
- **Lines saved**: ~200

#### 2D. Collapsible Behavior (`collapsible.js`)
- Replace with Hyperscript `_` behaviors on elements
- Example: `_="on click toggle .expanded on me then toggle .hidden on next .content"`
- **Lines saved**: ~60

#### 2E. SSE Progress Updates (`syncProgressUpdater.js`)
- Use HTMX SSE extension instead of manual EventSource management
- Declarative SSE: `hx-ext="sse" sse-connect="/api/progress/playlist/123" sse-swap="message"`
- **Lines saved**: ~214

#### 2F. Alert Dismissal (`alert.js`)
- Remove entirely - Bootstrap 5 handles this natively with `data-bs-dismiss="alert"`
- **Lines saved**: ~29

**Estimated Impact**: Removes ~1,103 lines of client JS, replaces with ~50 lines of Hyperscript

---

### Phase 3: CSS Refactoring (MEDIUM PRIORITY)

**Goal**: Eliminate all inline styles in favor of semantic CSS classes.

**Steps**:
1. Audit all inline `style=""` attributes (found in 15+ locations)
2. Create semantic class names in `style.css`:
   - `.playlist-expand-trigger` - Replace inline cursor/padding styles
   - `.modal-overlay`, `.modal-content` - Replace dynamic modal styles
   - `.progress-indicator`, `.progress-bar` - Replace inline progress styles
   - `.track-row--even`, `.track-row--odd` - Replace inline background colors
   - `.oauth-error-page` - Replace inline OAuth error styles
   - `.video-option` - Replace inline video selection styles
3. Update server templates to use classes
4. Remove all `style=""` attributes

**Estimated Impact**: Adds ~100 lines to CSS, removes ~50 inline style instances

---

### Phase 4: HTMX Extensions & Hyperscript Enhancement (LOWER PRIORITY)

**Goal**: Leverage HTMX extensions and Hyperscript for advanced interactions.

**Steps**:
1. Add HTMX SSE extension for real-time updates (replace manual SSE code)
   - Install: `<script src="https://unpkg.com/htmx.org/dist/ext/sse.js"></script>`
2. Use `hx-vals` for dynamic parameters instead of JavaScript
3. Use Hyperscript for:
   - Form validation
   - Animation triggers
   - Simple state toggles
   - Click handlers that used to be `onclick`
4. Consider `hx-boost` for progressive enhancement of regular links
5. Use `hx-indicator` consistently for loading states

**Estimated Impact**: Simplifies 4-5 complex interactions

---

## Implementation Order

Tackle **one phase at a time** with user approval after each:

1. **Phase 1** (Extract HTML templates) - Highest impact, makes subsequent phases easier
2. **Phase 2A** (Connection Status) - Smallest module, good learning experience
3. **Phase 2B** (Sync Functionality) - Most complex, biggest payoff
4. **Phase 2C-2F** (Remaining client JS) - Clean up all other client code
5. **Phase 3** (CSS cleanup) - Polish pass
6. **Phase 4** (HTMX extensions) - Advanced features

---

## Expected Benefits

**Code Reduction**:
- **-500 lines** of HTML in TypeScript routes
- **-1,103 lines** of imperative JavaScript
- **+50 lines** of declarative Hyperscript
- **+100 lines** of semantic CSS
- **-50 instances** of inline styles

**Improvements**:
- **Improved maintainability**: Separation of concerns, reusable templates
- **Better HTMX patterns**: Declarative, server-driven, minimal JavaScript
- **Easier testing**: Server templates can be tested independently
- **Reduced bundle size**: Less JavaScript to send to client
- **Better developer experience**: HTML in HTML files, not string literals

---

## HTMX/Hyperscript Best Practices (Reference)

### Idiomatic HTMX Patterns

1. **Server-driven UI**: HTML comes from server, not constructed in JS
2. **Declarative attributes**: Use `hx-get`, `hx-post`, not `htmx.ajax()`
3. **Minimal client JS**: Only for things HTMX/Hyperscript can't do
4. **Use extensions**: SSE, WebSockets, etc. have official extensions
5. **Progressive enhancement**: Works without JS, better with it
6. **Out-of-band swaps**: Use `hx-swap-oob` for updating multiple targets
7. **Polling**: Use `hx-trigger="every Xs"` for periodic updates
8. **Events**: Use `hx-trigger` with standard/custom events

### When to Use Hyperscript vs JavaScript

**Use Hyperscript for**:
- Simple DOM manipulation (show/hide, toggle classes)
- Event handling (click, hover, etc.)
- Simple animations
- Form validation
- State toggles

**Use JavaScript for**:
- Complex calculations
- Third-party library integration
- WebGL, Canvas, complex graphics
- Things that need to persist across page loads
- Performance-critical operations

### Common Anti-patterns to Avoid

❌ **Generating HTML in JavaScript**
```javascript
element.innerHTML = `<div class="card">${data.title}</div>`
```

✅ **Server returns HTML**
```html
<button hx-get="/api/card" hx-target="#container">Load</button>
```

---

❌ **Manual event listeners for HTMX requests**
```javascript
document.body.addEventListener('htmx:afterRequest', (e) => { ... })
```

✅ **Declarative attributes**
```html
<form hx-post="/api/submit" hx-on::after-request="this.reset()">
```

---

❌ **Inline onclick handlers**
```html
<button onclick="doSomething()">Click</button>
```

✅ **HTMX or Hyperscript**
```html
<button hx-post="/api/action">Click</button>
<!-- or -->
<button _="on click add .active to me">Click</button>
```

---

## Notes for Future Implementation

- The existing code uses Bootstrap 5, which works well with HTMX
- The app uses SSE for real-time progress - perfect for HTMX SSE extension
- Cookie-based auth is compatible with HTMX (includes cookies automatically)
- Consider caching strategy - HTMX respects Cache-Control headers
- Test progressive enhancement - ensure core features work without JS

---

## Questions for User (Before Starting Phase 1)

1. Template engine preference? Options:
   - Simple string replacement (lightweight)
   - EJS (full-featured, popular)
   - Handlebars (logic-less)
   - Pug (concise syntax)

2. Keep existing Bootstrap 5 for styling?

3. Any specific components that should NOT be refactored?

4. Performance concerns with server-rendering more HTML?

---

## Status Tracking

### Overall Progress

- [x] Phase 1: Extract HTML templates ✅ **COMPLETED**
- [x] Phase 2A: Connection Status refactor ✅ **COMPLETED**
- [x] Phase 2B: Sync Functionality refactor ✅ **COMPLETED**
- [ ] Phase 2C: Playlist Details refactor
- [ ] Phase 2D: Collapsible behavior refactor
- [ ] Phase 2E: SSE Progress refactor
- [ ] Phase 2F: Alert dismissal cleanup
- [ ] Phase 3: CSS refactoring
- [ ] Phase 4: HTMX extensions & enhancements

---

## Implementation Log

This section tracks what has been completed, issues encountered, and changes to the plan.

### 2025-10-10 - Initial Plan Created
- Completed full audit of codebase
- Identified 12 HTML generation instances, 1,391 lines of client JS, 50+ inline styles
- Created 4-phase refactoring plan
- **Status**: Awaiting user approval to begin Phase 1

---

### Phase 1: Extract HTML Templates [COMPLETED ✅]

**Target**: Remove ~500 lines of HTML from TypeScript routes

**Progress**:
- [x] Created `src/utils/htmlTemplates.ts` with TypeScript template literal functions
- [x] Extracted `oauthErrorPage()` template (spotify.ts:107-127, youtube.ts:106-126)
- [x] Extracted `errorMessage()` generic component with type/title/message/details support
- [x] Extracted `playlistItem()` template (spotify.ts:222-299) - 80+ lines → 15 lines
- [x] Extracted `playlistListContainer()` template (spotify.ts:309-314)
- [x] Extracted `authExpiredMessage()` template (spotify.ts:320-328)
- [x] Extracted `syncFeedback()` template (sync.ts:1123-1162) - 40+ lines → single function call
- [x] Updated all route files to use new templates
- [x] Tested all routes - server compiling successfully, all routes responding correctly

**Issues Encountered**:
- **Initial approach was wrong**: Created custom `templateRenderer.ts` with a template engine
- **User feedback**: "is there nothing that's natively in htmx or hyperscript that handles this?"
- **Resolution**: Deleted custom renderer, switched to simple TypeScript template literal functions
- **Lesson**: HTMX doesn't need or want a template engine - just use language-native string features

**Changes to Plan**:
- **MAJOR CHANGE**: Abandoned template files approach (`views/partials/*.html`)
- **MAJOR CHANGE**: Abandoned custom template renderer (`src/utils/templateRenderer.ts`)
- **NEW APPROACH**: Created simple TypeScript functions in `src/utils/htmlTemplates.ts` that return template literal strings
- This is the idiomatic HTMX way - no abstraction layer needed
- Provides type safety through TypeScript interfaces
- Includes `escapeHtml()` helper for XSS protection

**Files Created**:
- `src/utils/htmlTemplates.ts` - 6 reusable template functions (241 lines)

**Files Modified**:
- `src/routes/spotify.ts` - Replaced ~100 lines of inline HTML with template function calls
- `src/routes/youtube.ts` - Replaced OAuth error page with template function
- `src/routes/sync.ts` - Replaced 7 instances of inline HTML with template functions
- `src/routes/playlistDetails.ts` - Replaced 2 error messages with template functions

**Files Deleted**:
- `src/utils/templateRenderer.ts` (custom template engine - not needed)
- `views/partials/` directory (template files - not needed)

**Results**:
- ✅ Removed ~150 lines of HTML from routes
- ✅ All routes using type-safe template functions
- ✅ Server compiling with no TypeScript errors
- ✅ All routes tested and responding correctly (status 200)
- ✅ OAuth flows working (Spotify + YouTube)
- ✅ Playlist fetching and rendering working
- ✅ Playlist details expansion working
- ✅ XSS protection via escapeHtml() helper

**Remaining Work** (candidates for Phase 2/3):
- `playlistDetails.ts:303-391` - Large playlist details HTML (90+ lines) still has onclick handlers
- `playlistDetails.ts:445-488` - Video selection modal HTML still has onclick handlers
- These will be addressed when converting onclick to HTMX/Hyperscript in Phase 2

---

### Phase 2A: Connection Status [COMPLETED ✅]

**Target**: Remove ~200 lines from `connectionStatus.js`

**Progress**:
- [x] Created `connectionButton()` template function in `htmlTemplates.ts`
- [x] Created server endpoints `/api/status/spotify/button` and `/api/status/youtube/button`
- [x] Updated `index.html` to use HTMX attributes for loading and polling
- [x] Removed `connectionStatus.js` script from HTML
- [x] Deleted `public/js/connectionStatus.js` file
- [x] Added proper error logging to connection check endpoints

**Issues Encountered**:
- **Initial implementation swallowed errors**: Connection check endpoints had empty catch blocks with just comments
- **User feedback**: "why are you just swallowing errors"
- **Resolution**: Added proper `Logger.auth()` calls in catch blocks to log error details

**Changes to Plan**:
- Used regular anchor links (`<a href="/auth/spotify/login">`) for connect buttons instead of HTMX navigation, since OAuth requires full page redirect
- Polling interval set to 5 minutes (was 5 minutes in original code)
- HTMX triggers on `load` (page load) and `every 5m` (polling)
- Added error logging with message and status/error code for debugging

**Files Created**:
- None (added to existing files)

**Files Modified**:
- `src/utils/htmlTemplates.ts` - Added `connectionButton()` function
- `src/server.ts` - Added `/api/status/spotify/button` and `/api/status/youtube/button` endpoints with proper error logging
- `views/index.html` - Added HTMX attributes to connection status divs, removed connectionStatus.js script

**Files Deleted**:
- `public/js/connectionStatus.js` - Deleted 232 lines of client-side JavaScript

**Results**:
- ✅ Removed all client-side button generation code
- ✅ Eliminated sessionStorage usage for connection state
- ✅ Converted to declarative HTMX polling
- ✅ Server-driven connection status
- ✅ Deleted 232 lines of JavaScript
- ✅ No more manual DOM manipulation or global function exposure
- ✅ Proper error logging for connection check failures

---

### Phase 2B: Sync Functionality [COMPLETED ✅]

**Target**: Remove ~400 lines from `syncFunctionality.js`

**Progress**:
- [x] Simplified SSE handling in `public/js/sync.js` - reduced from 590 lines to 60 lines
- [x] Created `progressUpdate()` template function in `htmlTemplates.ts`
- [x] Created SSE progress endpoint `/api/progress/playlist/:playlistId` in `src/routes/progress.ts`
- [x] Integrated SSE progress updates with HTMX lifecycle events
- [x] Removed sessionStorage usage and manual HTMX event handling
- [x] Fixed SSE message format issue - HTML must be minified to single line for SSE protocol compliance
- [x] Deleted empty `playlistStorage.js` file and removed script tag

**Issues Encountered**:
- **SSE message format broken**: Multi-line HTML was being sent via SSE without proper formatting
- **User feedback**: "the status bar when updating playlists doesn't work at all any more"
- **Root cause**: SSE protocol requires data to be on a single line or each line prefixed with "data: ". Multi-line HTML from `progressUpdate()` template broke SSE messages.
- **Resolution**: Added HTML minification in `progress.ts` line 81: `const minifiedHtml = html.replace(/\s+/g, ' ').trim();` before sending via SSE
- **Forgot cleanup**: Left empty `playlistStorage.js` file after refactoring
- **User feedback**: "are there _any other_ things in the repo that are unused either because of our work or that were already unused that we can clean up?"
- **Resolution**: Deleted `playlistStorage.js`, removed script tag, verified no other unused code

**Changes to Plan**:
- Used simplified EventSource client instead of HTMX SSE extension (simpler for this use case)
- Server sends HTML directly via SSE (HTML-over-the-wire pattern)
- Client swaps HTML directly into progress div using `innerHTML`
- HTMX lifecycle events (`htmx:beforeRequest`, `htmx:afterRequest`) trigger SSE connection start/stop
- HTML must be minified before sending via SSE to comply with single-line data requirement

**Files Created**:
- None (added to existing files)

**Files Modified**:
- `src/utils/htmlTemplates.ts` - Added `progressUpdate()` function for SSE progress HTML
- `src/routes/progress.ts` - Added SSE endpoint, HTML minification for SSE format compliance
- `public/js/sync.js` - Simplified to 60 lines, removed manual HTMX event handling and sessionStorage usage
- `views/index.html` - Removed playlistStorage.js script tag

**Files Deleted**:
- `public/js/syncFunctionality.js` - Deleted 590 lines of complex client-side JavaScript
- `public/js/playlistStorage.js` - Deleted empty/unused file (6 lines of comments)

**Results**:
- ✅ Reduced client-side JavaScript from 590 lines to 60 lines (91% reduction)
- ✅ Eliminated sessionStorage usage for state management
- ✅ Simplified SSE connection management - auto-starts on sync, auto-closes on completion
- ✅ Server-driven progress updates with HTML-over-the-wire
- ✅ Fixed SSE message format issue with HTML minification
- ✅ Cleaned up unused files (playlistStorage.js)
- ✅ Real-time progress bar now works correctly

---

### Phase 2C: Playlist Details [NOT STARTED]

**Target**: Remove ~200 lines from `playlistDetails.js`

**Progress**: Not started

**Issues Encountered**: None yet

**Changes to Plan**: None yet

**Files Modified**: None yet

---

### Phase 2D: Collapsible Behavior [NOT STARTED]

**Target**: Remove ~60 lines from `collapsible.js`

**Progress**: Not started

**Issues Encountered**: None yet

**Changes to Plan**: None yet

**Files Modified**: None yet

---

### Phase 2E: SSE Progress Updates [NOT STARTED]

**Target**: Remove ~214 lines from `syncProgressUpdater.js`

**Progress**: Not started

**Issues Encountered**: None yet

**Changes to Plan**: None yet

**Files Modified**: None yet

---

### Phase 2F: Alert Dismissal [NOT STARTED]

**Target**: Remove ~29 lines from `alert.js`

**Progress**: Not started

**Issues Encountered**: None yet

**Changes to Plan**: None yet

**Files Modified**: None yet

---

### Phase 3: CSS Refactoring [NOT STARTED]

**Target**: Remove ~50 inline style instances, add ~100 lines of semantic CSS

**Progress**: Not started

**Issues Encountered**: None yet

**Changes to Plan**: None yet

**Files Modified**: None yet

---

### Phase 4: HTMX Extensions [NOT STARTED]

**Target**: Simplify 4-5 complex interactions

**Progress**: Not started

**Issues Encountered**: None yet

**Changes to Plan**: None yet

**Files Modified**: None yet

---

## Lessons Learned

This section captures important insights for future refactoring work.

1. **Don't over-engineer template solutions**: HTMX doesn't need a custom template engine. Use language-native features (TypeScript template literals). Keep it simple.

2. **Always add proper error logging**: Empty catch blocks hide problems. Always log errors with relevant context (error message, status codes, service names).

3. **Clean up after refactoring**: Remember to delete unused files and verify no references remain. Make cleanup a standard step in the refactoring checklist.

4. **OAuth requires full page redirects**: Can't use HTMX `hx-get` for OAuth flows - they need full page navigation to handle the redirect flow properly.

5. **SSE message format requirements**: When sending HTML via Server-Sent Events, the HTML must be minified to a single line (or each line prefixed with "data: "). Multi-line HTML breaks SSE protocol and causes messages to fail silently.

6. **Type safety matters**: TypeScript interfaces for template parameters catch errors at compile time and improve developer experience.

---

**Current Status**: Phase 2B COMPLETED ✅ - Sync functionality refactored, SSE progress fixed
**Next Step**: Begin Phase 2C - Playlist Details refactor (`playlistDetails.js`)
