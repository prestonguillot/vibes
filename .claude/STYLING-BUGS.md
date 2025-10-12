# Styling Bugs and Issues

## Priority: HIGH

### ✅ STYLE-001: Inconsistent border styling on playlist details container
**Location**: `public/css/style.css:776-788`
**Status**: FIXED
**Fix Applied**: Removed redundant CSS declarations:
- Consolidated multiple `padding` declarations into single `padding: 2rem`
- Removed contradictory `margin-left: -15px` and `padding-left: 15px`
- Simplified to essential properties only

### ✅ STYLE-002: Playlist expand/collapse hover effects are visually cluttered
**Location**: `public/css/style.css:925-936`
**Status**: FIXED
**Fix Applied**: Simplified hover effects:
- Removed complex pseudo-element positioning and red highlight boxes
- Removed scale animations
- Simplified to just color change on hover (#666 → #ff0040)
- Maintained smooth transition for better UX

### ✅ STYLE-003: Duplicate `.sync-btn` class definitions
**Location**: `public/css/style.css:147, 580-597, 759`
**Status**: FIXED
**Fix Applied**: Consolidated three definitions into one:
- Merged all properties into comprehensive definition at line 580
- Added comments at lines 147 and 759 referencing consolidated definition
- Organized properties by category (Layout, Typography, Borders)

## Priority: MEDIUM

### ✅ STYLE-004: Responsive design breakpoint insufficient
**Location**: `public/css/style.css:909-985`
**Status**: FIXED
**Fix Applied**: Added comprehensive responsive breakpoints:
- **Mobile (≤768px)**: Smaller fonts, stacked button layout, reduced padding
- **Tablet (769px-1024px)**: Medium-sized elements, full-width container with padding
- **Large Desktop (≥1400px)**: Larger container (1400px), bigger title, enhanced shadows
- Fixed button layout overlap on mobile by unstacking playlist buttons

### ✅ STYLE-005: Loading spinner styles are overly specific with !important
**Location**: `public/css/style.css:846-910`
**Status**: FIXED
**Fix Applied**: Refactored spinner styles to minimize !important usage:
- Removed !important from base `.spinner-border` styles (reduced from 13 to 0)
- Kept !important only for attribute selectors that override inline styles
- Added documentation explaining why !important is needed for specific cases
- Consolidated duplicate `.spinner-xs` definition
- Created clearer separation between class-based and attribute-based styling

### ✅ STYLE-006: Card transform rotations may cause layout issues
**Location**: `public/css/style.css:442-457`
**Status**: FIXED
**Fix Applied**: Reduced rotation angles to minimize visual artifacts:
- Reduced card rotation from 0.2deg/-0.3deg to 0.05deg/-0.05deg (75% reduction)
- Removed rotation from hover state to prevent text blurriness during interaction
- Added explanatory comments documenting the rationale
- Maintains subtle punk aesthetic while improving text readability

### ✅ STYLE-007: Form control styling inconsistency
**Location**: `public/css/style.css:1015-1051`, `views/index.ejs:83-88`
**Status**: FIXED
**Fix Applied**: Applied consistent punk styling to all form controls:
- Added comprehensive styling for `.form-select` and `select` elements
- Matched checkbox styling: square borders (border-radius: 0), 2px solid black
- Applied Courier Prime monospace font with uppercase text and letter-spacing
- Added punk-themed focus states (red border with shadow)
- All form controls now share consistent aesthetic with rest of UI

## Priority: LOW

### ✅ STYLE-008: Text overflow handling is inconsistent
**Location**: `public/css/style.css:742-746, 805-810`
**Status**: REVIEWED - INTENTIONAL DESIGN
**Findings**: After review, the text overflow strategy is intentionally different for good UX reasons:
- **Playlist names** (`.playlist-info`, lines 742-746): Use word-wrap to show full title - important for identifying playlists
- **Track titles/artists** (lines 805-810): Use ellipsis truncation - prevents long lists from becoming unwieldy
- This is a deliberate UX choice, not a bug
**Conclusion**: No changes needed - current implementation is optimal

### ✅ STYLE-009: Unused or redundant CSS selectors
**Location**: `public/css/style.css:1053-1077`
**Status**: FIXED
**Fix Applied**: Removed unused BEM modifier classes:
- Removed `.video-option__description--truncated` (not used in any templates)
- Removed `.selection-indicator--hidden` (not used in any templates)
- Verified via grep search across all `.ejs`, `.html`, and `.js` files
- Renamed section from "NEW SEMANTIC CLASSES FOR PHASE 3" to "UTILITY CLASSES"
- Kept only actively-used utility classes (`.form-select-auto`, `.loading-indicator`)

### STYLE-010: Color values are hard-coded throughout
**Location**: `public/css/style.css` (throughout)
**Status**: DEFERRED - FUTURE ENHANCEMENT
**Description**: Colors are hard-coded as hex values:
- `#ff0040` (punk red) appears 20+ times
- `#00ff00` (punk green) appears 10+ times
- `#0066ff` (punk blue) appears 10+ times
- `#000` (black) appears 50+ times
**Impact**: Would improve maintainability and enable future theming
**Recommendation**: Defer to future refactor due to:
- Large scope (100+ occurrences across entire stylesheet)
- Risk of introducing bugs with mass find/replace
- Current color usage is consistent and working well
- Would benefit from dedicated testing after implementation
**Future Implementation**: Use CSS custom properties (`:root` variables) for main color palette

## Summary

- **High**: 3 bugs (CSS conflicts, duplicate definitions)
- **Medium**: 4 bugs (responsive design, !important overuse, transforms, form inconsistency)
- **Low**: 3 bugs (text overflow, unused classes, color management)

**Total**: 10 styling issues identified
