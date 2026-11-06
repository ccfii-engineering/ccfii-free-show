---
name: FreeShow Remote and Controller
description: Scoped operator visual system for Remote Media and Controller presentation.
colors:
  operator-canvas: "#171513"
  operator-surface: "#211e1b"
  operator-raised: "#2c2824"
  operator-text: "#f4f1ed"
  operator-crimson: "#810e0e"
  operator-amber: "#faa739"
  operator-crimson-strong: "#9b2424"
  operator-on-amber: "#211506"
  operator-preview: "#070707"
  operator-muted: "rgb(244 241 237 / 72%)"
  operator-border: "rgb(244 241 237 / 14%)"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "16px"
rounded:
  sm: "8px"
  md: "12px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.operator-amber}"
    textColor: "#211506"
    rounded: "{rounded.sm}"
    height: "48px"
  button-launch:
    backgroundColor: "{colors.operator-amber}"
    textColor: "{colors.operator-canvas}"
    rounded: "9px"
    height: "52px"
  button-clear:
    backgroundColor: "{colors.operator-crimson}"
    textColor: "{colors.operator-text}"
    rounded: "{rounded.sm}"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.operator-raised}"
    textColor: "{colors.operator-text}"
    rounded: "{rounded.sm}"
  media-row:
    backgroundColor: "{colors.operator-surface}"
    textColor: "{colors.operator-text}"
    rounded: "10px"
    padding: "8px 12px"
  preview-panel:
    backgroundColor: "{colors.operator-surface}"
    textColor: "{colors.operator-text}"
    rounded: "{rounded.md}"
    padding: "10px"
  navigation-tab:
    backgroundColor: "{colors.operator-canvas}"
    textColor: "{colors.operator-muted}"
    rounded: "{rounded.sm}"
    height: "56px"
  connection-state:
    backgroundColor: "{colors.operator-raised}"
    textColor: "{colors.operator-text}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
---

# Design System: FreeShow Remote and Controller

## Overview

**Creative North Star: "The Live Operator Desk"**

This is a focused working surface for an operator who is following a live presentation. Real current and next slide content leads the scan; notes, media previews, and clearly labeled controls stay close to the decision they support. The surrounding interface uses restrained warm neutrals, while CCFII crimson and amber identify a small set of brand and action states.

The system covers the modernized Remote media journey and the Controller presentation surface, including the tablet route that places selected media in its existing workspace. Shared focus and selection styling also loads with the Remote and Controller app shells. The tablet Remote shell adopts the operator palette through the `.tabletMode` variable override in `operator.css` (colour only; its multi-pane layout and drawer behaviour are unchanged, and the layout follow-up is tracked in [issue #53](https://github.com/ccfii-engineering/ccfii-free-show/issues/53)). Auth, other Remote destinations, Stage, Camera, the desktop application, and authored slide themes are outside the visual redesign scope.

**Key Characteristics:**
- Actual slide previews and notes remain the primary content.
- Warm neutral surfaces carry most of the interface.
- Amber marks selection, focus, advance, and explicit media launch.
- Crimson stays with CCFII identity, Clear, and error feedback.
- Compact, labeled controls adapt to phone, tablet, desktop, and short viewports.

## Colors

The palette uses dark, slightly warm surfaces and soft white text, with the established CCFII crimson and amber reserved for recognizable state and action roles.

### Primary
- **CCFII Amber:** Use for keyboard focus, selected media, the primary Next action, and explicit Play on output.

### Secondary
- **CCFII Crimson:** Keep for the identity mark, Clear, and error feedback.

### Neutral
- **Night Canvas:** The main ground for the operator views and Remote navigation.
- **Warm Surface:** Media rows, Controller panels, notes, and control regions.
- **Raised Surface:** Selected or pressed rows and secondary controls.
- **Soft White:** Primary labels, content, and controls.
- **Muted Warm White:** Supporting text and metadata.
- **Soft Border:** Thin separators and panel edges.

**The State Accent Rule.** Amber carries selection, focus, and primary-action state; crimson carries identity, Clear, and errors. Connected, live, disabled, and loading states also need labels or other non-color cues.

## Typography

**Display Font:** No separate display face.  
**Body Font:** System UI stack: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif.  
**Label/Mono Font:** The same system stack; counters use tabular numerals where shown.

**Character:** Quiet, compact, and familiar on operator devices. Use weight and spacing for hierarchy rather than a decorative face.

### Hierarchy
- **Headline** (650, 1.2rem in the Remote media header): Identify the selected item or surface.
- **Title** (650, about 0.95rem in Controller panels): Label Current, Next, and Notes.
- **Body** (16px base in Controller; regular system size in Remote): Keep slide notes and supporting copy readable.
- **Label** (600, roughly 0.82–0.875rem; compact navigation captions are 11px): Keep actions and metadata short and scannable.

Use sentence case. Truncate long filenames only in list rows where the full name remains available in the selected preview. Keep slide and playback counters tabular.

## Layout

Remote keeps five labeled phone destinations: Projects, Shows, Media, Scripture, and Control. A selected media preview continues to identify Media as the active destination. Media browsing uses one column on narrow phones and a responsive row grid when space allows. The tablet keeps its existing multi-pane shell and dockable drawer; selected media flows into the workspace preview while the drawer remains available.

Controller stacks Current and Next on narrow screens and places them side by side when width permits. Notes remain below the previews in their own scrollable region. The control row stays anchored to the workspace; the landscape layout reduces preview height as viewport height tightens so notes and controls remain reachable. Draw mode keeps the live output context and sizes its canvas from the output aspect ratio, bounded by available height and width.

Use the observed 4/8px rhythm for local gaps and padding, with 12–16px phone insets and 24px tablet/desktop content insets. Respect safe-area insets around bottom controls. Keep the primary action targets at least 44px high; compact breadcrumbs are secondary navigation controls.

## Elevation & Depth

The updated operator surfaces are flat at rest. Separate regions with tonal surface changes and a subtle one-pixel border, not a drop shadow. Focus is an outline; the active media row and Controller mode use color and border changes. Real slide imagery supplies depth inside the preview frame.

## Shapes

Use gently rounded corners rather than circles for panels and primary controls. Common actions use 8px corners, media rows 10px, and preview/notes panels 12px; the Controller footer is slightly more rounded. The Remote connection-state label is the pill-shaped exception. Keep borders thin and let the frame crop media to a stable 16:9 ratio.

## Components

### Buttons
- **Primary advance:** Amber, dark text, 48px high on Controller; keep its label visible at narrow widths.
- **Explicit media launch:** Amber with canvas-colored text and a 52px target. “Play on output” remains a separate action after selection.
- **Secondary:** Raised neutral surface with a thin border; use for Previous and playback utilities.
- **Clear:** Separate crimson action. It remains one tap.
- **Hover / Focus:** Hover shifts border toward amber. Keyboard focus uses a visible amber outline; active buttons depress slightly. Reduced-motion preference removes state-transition motion.

### Chips
- **Connection state:** Remote uses a compact pill on a raised surface; Controller uses a dot and text. Keep the state wording visible.

### Cards / Containers
- **Controller previews:** Current and Next panels share a neutral surface and stable 16:9 frame.
- **Notes:** Keep the text in its own bordered, scrollable region with a comfortable measure.
- **Media rows:** Use a single selectable row with thumbnail/type, filename, metadata, and a clear selected state.
- **Shadow strategy:** Flat surfaces; separation comes from tone and the border token.

### Navigation
Phone navigation uses five text-labeled destinations. The selected state uses amber text and an outline; the media preview route maps back to Media. On tablet, use the existing drawer/workspace rather than replacing the shell; the shell takes the operator palette only (issue #53 covers layout).

### Inputs / Fields
This modernization adds no new operator input style. Existing form fields keep their host app styling.

### Drawing surface
Keep the canvas at the output's aspect ratio and use the current output image as context when available. Place the labeled tool selector beside the drawing controls, and keep Clear drawing separate from output Clear.

**The Current and Next Rule.** Keep the preview order explicit, put notes directly after the pair, and keep their content visible while the operator acts.

## Do's and Don'ts

### Do:
- **Do** keep Current, Next, and Notes in the operator's first scan path.
- **Do** preserve a useful preview ratio, and derive the drawing canvas ratio from the live output.
- **Do** distinguish selected media from a launch in progress, a sent item, and active playback.
- **Do** keep action names visible and connection state textual.
- **Do** retain the CCFII emblem and use the established identity colors for their observed roles.

### Don't:
- **Don't** send media live when a row is selected; launch stays explicit.
- **Don't** disable Next only because a next-slide preview is absent.
- **Don't** use color alone for connected, selected, live, disabled, or error states.
- **Don't** add decorative gradients, glass effects, or nested cards to these operator surfaces.
- **Don't** extend these tokens to Stage, Camera, the desktop interface, or authored slide themes.
