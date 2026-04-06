# FreeShow - CCFII Edition: Branding Design Spec

## Overview

Rebrand the forked FreeShow application to reflect CCFII (Christ Charismatic Fellowship Int'l, Inc.) identity. This is a **theme-level rebrand** — FreeShow remains the product name, with CCFII as the edition/provider. The approach uses FreeShow's existing theme system for colors plus targeted asset swaps for icons, splash screen, and metadata.

**Approach**: Hybrid — Theme System + Targeted Asset Swaps

## Brand Source

All branding is derived from https://ccfii.org/:

- **Primary color**: `#810e0e` (deep crimson/maroon)
- **Accent color**: `#faa739` (warm amber/gold)
- **Background dark**: `#120a0a` (near-black with warm reddish undertone)
- **Background darker**: `#0a0505` (deepest dark)
- **Surface dark**: `#1e1414` (dark reddish-brown for cards/surfaces)
- **Logo**: Circular badge with open Bible and radiating golden light (658x658 PNG)
- **Style**: Dark, cinematic, worship-conference aesthetic with warm glow effects

## Section 1: CCFII Default Theme

**Files**: `src/frontend/components/settings/tabs/defaultThemes.ts`, `public/global.css`

Replace the `default` theme colors with CCFII's palette. The `default` theme key stays the same so it loads on first launch.

### Theme Color Mapping

| CSS Variable | Current Value | CCFII Value | Notes |
|---|---|---|---|
| `--primary` | `#242832` | `#120a0a` | Main background |
| `--primary-lighter` | `#2f3542` | `#1e1414` | Surface/hover backgrounds |
| `--primary-darker` | `#191923` | `#0a0505` | Deeper sections |
| `--primary-darkest` | `#12121c` | `#0a0505` | Deepest dark |
| `--text` | `#f0f0ff` | `#f0f0ff` | Keep white text (unchanged) |
| `--textInvert` | `#131313` | `#131313` | Keep dark invert (unchanged) |
| `--secondary` | `#F0008C` | `#810e0e` | Crimson primary accent |
| `--secondary-opacity` | `rgba(240, 0, 140, 0.5)` | `rgba(129, 14, 14, 0.5)` | Crimson at 50% |
| `--secondary-text` | `#f0f0ff` | `#f0f0ff` | Keep (unchanged) |
| `--accent` | `#90caf9` | `#faa739` | Amber/gold accent |
| `--transparent` | `#232530` | `#1a1010` | Warm dark transparent |
| `--hover` | `rgb(255 255 255 / 0.05)` | `rgb(255 255 255 / 0.05)` | Keep (unchanged) |
| `--focus` | `rgb(255 255 255 / 0.1)` | `rgb(255 255 255 / 0.1)` | Keep (unchanged) |

Update both:
1. `defaultThemes.ts` — the `default` theme object's `colors` property
2. `global.css` — the `:root` CSS variable defaults

Other built-in themes (dark, light, blue, etc.) remain unchanged.

## Section 2: Loading/Splash Screen

**File**: `public/loading.html`

Replace the current FreeShow splash with a CCFII cinematic dark splash.

### Current State
- 500x280px transparent frameless window
- Purple gradient background (`#28276d` to `#150f30`)
- FreeShow logo image on left, "FreeShow" gradient text on right
- Animated loader bar at top

### New Design
- **Background**: `linear-gradient(140deg, #1e1414 20%, #0a0505)` (warm dark reddish-black)
- **Layout**: Centered composition
  - CCFII logo (`ccfii-logo.png`) centered, ~120px height
  - Amber glow drop-shadow: `drop-shadow(0 0 12px rgba(250, 167, 57, 0.4))`
  - "FreeShow" in white text below logo
  - "CCFII Edition" subtitle in amber `#faa739`
  - Version number in low opacity
- **Loader bar**: Color changes from magenta to crimson `#810e0e`
- **Startup image**: Remove `startup.webp` reference, use centered logo composition
- **Window title**: `FreeShow - CCFII Edition`

## Section 3: Startup/Welcome Screen

**File**: `src/frontend/components/main/Splash.svelte`

### Changes
- Add CCFII logo (~80px) centered above the title, with subtle amber glow
- Title "FreeShow" stays as main heading, styled in white (not secondary color)
- Add "CCFII Edition" subtitle in amber `#faa739`, smaller font, uppercase with letter-spacing
- Version, verse of the day, docs link, splash text, and action buttons all remain unchanged
- Action buttons inherit new theme colors naturally

## Section 4: About Dialog

**File**: `src/frontend/components/main/popups/About.svelte`

### Changes
- Replace logo image (`freeshow.webp`) with CCFII logo (`ccfii-logo.png`), ~50px height
- Title: "FreeShow" becomes "FreeShow - CCFII Edition"
- Add line below version: "Christ Charismatic Fellowship Int'l, Inc." in subtle text
- Add link: "CCFII Website" pointing to `https://ccfii.org/`
- Keep ALL existing links (ChurchApps, GitHub Issues, Transifex, churchapps.org/partner)
- Keep ALL existing credits and "Created by Kristoffer Vassbø (2021)"

## Section 5: App Identity & Metadata

### File Changes

| File | Field | Current | New |
|---|---|---|---|
| `public/index.html` | `<title>` | `FreeShow` | `FreeShow - CCFII Edition` |
| `public/loading.html` | `<title>` | `FreeShow - Loading` | `FreeShow - CCFII Edition` |
| `package.json` | `description` | `Show song lyrics and more for free!` | `FreeShow - CCFII Edition: Show song lyrics and more for free!` |
| `src/electron/utils/windowOptions.ts` | `backgroundColor` (main) | `#242832` | `#120a0a` |
| `config/building/electron-builder.yaml` | `productName` | `FreeShow` | `FreeShow - CCFII Edition` |
| `config/building/electron-builder.yaml` | `artifactName` | `FreeShow-${version}...` | `FreeShow-CCFII-${version}...` |

### App Icons

Replace with CCFII-logo-based icons (circular badge on dark background):
- `public/icon.png` — general app icon
- `public/icon.ico` — Windows favicon
- `public/icon.icns` — macOS app icon
- `public/512x512.png` — high-resolution icon

## Section 6: Scope Boundaries (What We're NOT Changing)

- `package.json` `name` field stays `freeshow` (changing it breaks build tooling)
- All built-in themes remain available for users to switch to
- Core UI layout, component structure, and functionality unchanged
- Original creator credits and ChurchApps links preserved
- No custom font imports — system font stack stays
- Server apps (remote, stage, controller, output_stream, cam) unchanged — they inherit theme colors
- No `appId` change in electron-builder (would break auto-update paths)

## Design Decisions

1. **Theme-level, not full rebrand**: Respects FreeShow as the product. CCFII is the edition/provider, not a replacement.
2. **Hybrid approach**: Theme system for colors (merge-friendly), targeted asset swaps for identity (splash, icons, about). Minimizes diff surface for upstream merges.
3. **CCFII theme replaces default key**: Ensures it loads on first launch without needing migration logic. Existing users who customized their theme won't be affected (their saved theme persists).
4. **Cinematic dark splash**: Matches the CCFII website's dark worship-conference aesthetic. The amber glow on the logo creates warmth against the near-black background.
5. **Credits preserved**: The About dialog keeps all original FreeShow attribution. CCFII info is additive, not replacing.
