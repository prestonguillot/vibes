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

### STYLE-004: Responsive design breakpoint insufficient
**Location**: `public/css/style.css:920-933`
**Description**: Only one responsive breakpoint at 768px:
- No tablet-specific styling (768px-1024px)
- No large desktop optimization (>1200px)
- Button sizing may be too aggressive on mobile
**Impact**: Suboptimal layout on tablets and large screens
**Fix**: Add additional breakpoints for better responsive behavior

### STYLE-005: Loading spinner styles are overly specific with !important
**Location**: `public/css/style.css:856-894`
**Description**: Spinner styles use excessive `!important` declarations (20+ instances):
- Makes it difficult to override for specific contexts
- Indicates potential specificity issues
- Inline style overrides add complexity (lines 877-879)
**Impact**: Difficult to customize or debug spinner styles
**Fix**: Refactor to use proper CSS specificity without !important

### STYLE-006: Card transform rotations may cause layout issues
**Location**: `public/css/style.css:448-457`
**Description**: Cards use CSS transforms (rotate) that could:
- Cause text to appear slightly blurry on some displays
- Create unexpected spacing issues
- May not work well on all browsers/devices
**Impact**: Potential visual artifacts and layout shifts
**Fix**: Consider reducing rotation angles or making them optional

### STYLE-007: Form control styling inconsistency
**Location**: `public/css/style.css:987-1002`, `views/index.ejs:83-88`
**Description**: Form controls (checkboxes, selects) have:
- Checkbox styling with border-radius: 0 (line 989)
- But select elements don't have matching punk styling
- Form labels are uppercase but select options are not
**Impact**: Visual inconsistency in form elements
**Fix**: Apply consistent punk styling to all form controls

## Priority: LOW

### STYLE-008: Text overflow handling is inconsistent
**Location**: `public/css/style.css:813-818, 735-738`
**Description**: Text truncation with ellipsis is applied to:
- `.track-title`, `.track-artist`, `.youtube-video a` (line 813)
- But not consistently to playlist names or other long text
- `.playlist-info` has word-wrap but not ellipsis (line 735)
**Impact**: Some text overflows while other text wraps awkwardly
**Fix**: Apply consistent text overflow strategy across similar elements

### STYLE-009: Unused or redundant CSS selectors
**Location**: `public/css/style.css:1022-1026, 1028-1031`
**Description**: Classes defined but may not be used:
- `.video-option__description--truncated` (line 1023)
- `.selection-indicator--hidden` (line 1029)
- These use BEM modifier syntax but may be redundant
**Impact**: Code bloat, confusion about which classes to use
**Fix**: Audit template usage and remove unused classes

### STYLE-010: Color values are hard-coded throughout
**Location**: `public/css/style.css` (throughout)
**Description**: Colors are hard-coded as hex values:
- `#ff0040` (red/pink) appears 20+ times
- `#00ff00` (green) appears 10+ times
- `#0066ff` (blue) appears 10+ times
- `#000` (black) appears 50+ times
**Impact**: Difficult to maintain consistent color scheme, hard to theme
**Fix**: Consider using CSS custom properties (variables) for color palette

## Summary

- **High**: 3 bugs (CSS conflicts, duplicate definitions)
- **Medium**: 4 bugs (responsive design, !important overuse, transforms, form inconsistency)
- **Low**: 3 bugs (text overflow, unused classes, color management)

**Total**: 10 styling issues identified
