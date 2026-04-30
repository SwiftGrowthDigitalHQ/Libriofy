# Scan Kiosk Responsive Debug

## Root Cause

The `ScanKioskPage` was not behaving responsively on mobile and tablet because the page was entering `kiosk-mode`, which sets `body` and `#root` to `overflow: hidden`.

At the same time:

- the page shell used `overflow-hidden`
- the main content area also used `overflow-hidden`
- the desktop split layout started at `lg`, so tablet screens stayed in a tall single-column layout

This combination created a scroll trap on smaller screens. Content below the fold looked cut off even though the classes were technically responsive.

## Responsive Rules

### Mobile

- Breakpoint: below `768px`
- Layout: single column
- Behavior: main content scrolls vertically inside the kiosk shell
- Goal: scanner stays readable and all status/activity cards remain reachable

### Tablet

- Breakpoint: `768px` to `1023px`
- Layout: stacked scanner section with a 2-column status card grid
- Behavior: header reorganizes into multiple rows and main content keeps vertical scrolling
- Goal: avoid cramped desktop-style split layout while reducing page height

### Laptop and Desktop

- Breakpoint: `1024px` and above
- Layout: split scanner + status panel layout
- Behavior: desktop shell keeps the kiosk-style contained layout
- Goal: use wide space efficiently without clipping the scanner frame

## Implemented Fix

- Added vertical scrolling to the kiosk main area for non-desktop screens
- Added `md` layout handling for header and side cards
- Expanded activity grid behavior across `md`, `lg`, and `xl`
- Kept the contained kiosk layout for laptop and larger screens
