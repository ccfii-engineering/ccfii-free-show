# CCFII Edition Branding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the forked FreeShow app as "FreeShow - CCFII Edition" with CCFII colors, logo, splash screen, startup screen, about dialog, and app metadata.

**Architecture:** Uses FreeShow's existing Svelte theme system for color changes (CSS custom properties applied at runtime via `updateThemeValues()`). Targeted asset swaps for icons, splash screen HTML, and Svelte components. Minimal diff surface for upstream merge compatibility.

**Tech Stack:** Svelte 3, TypeScript, Electron, HTML/CSS, ImageMagick (for icon generation)

**Spec:** `docs/superpowers/specs/2026-04-06-ccfii-branding-design.md`

---

## Chunk 1: Theme Colors & CSS Variables

### Task 1: Update default theme in defaultThemes.ts

**Files:**
- Modify: `src/frontend/components/settings/tabs/defaultThemes.ts:3-24`

- [ ] **Step 1: Update the default theme colors**

Replace the `default` theme object's `colors` property with CCFII values:

```typescript
default: {
    name: "default",
    default: true,
    font: {
        family: "",
        size: "1em"
    },
    colors: {
        primary: "#120a0a",
        "primary-lighter": "#1e1414",
        "primary-darker": "#0a0505",
        "primary-darkest": "#0a0505",
        text: "#f0f0ff",
        textInvert: "#131313",
        "secondary-text": "#f0f0ff",
        secondary: "#810e0e",
        "secondary-opacity": "rgba(129, 14, 14, 0.5)",
        hover: "rgb(255 255 255 / 0.05)",
        focus: "rgb(255 255 255 / 0.1)"
    }
},
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/settings/tabs/defaultThemes.ts
git commit -m "feat(theme): update default theme to CCFII color palette"
```

### Task 2: Update global.css root variables

**Files:**
- Modify: `public/global.css:30-57`

- [ ] **Step 1: Update :root CSS variables**

Replace the `:root` block with CCFII defaults:

```css
:root {
    --primary: #120a0a;
    --primary-lighter: #1e1414;
    --primary-darker: #0a0505;
    --primary-darkest: #0a0505;
    --text: #f0f0ff;
    --textInvert: #131313;
    --secondary: #810e0e;
    --secondary-opacity: rgba(129, 14, 14, 0.5);
    --secondary-text: #f0f0ff;
    --transparent: #1a1010;

    --accent: #faa739;

    --connected: #27a827;
    --disconnected: #a82727;

    --red: rgb(255 0 0 / 0.25);

    --hover: rgb(255 255 255 / 0.05);
    --focus: rgb(255 255 255 / 0.1);

    /* https://css-tricks.com/snippets/css/system-font-stack/ */
    --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
    --font-size: 1em;

    --navigation-width: 290px;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/global.css
git commit -m "feat(theme): update global CSS variables to CCFII palette"
```

---

## Chunk 2: Loading/Splash Screen

### Task 3: Redesign loading.html with CCFII branding

**Files:**
- Modify: `public/loading.html` (full rewrite)

The CCFII logo is already at `public/ccfii-logo.png` (downloaded earlier).

- [ ] **Step 1: Replace loading.html with CCFII cinematic splash**

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>FreeShow - CCFII Edition</title>

        <style>
            :root {
                --radius: 5px;
                --loader-height: 3px;
                --crimson: #810e0e;
                --amber: #faa739;
                --bg-dark: #0a0505;
                --bg-surface: #1e1414;
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
                color: #f0f0ff;
                width: 100%;
                height: 100vh;
                overflow: hidden;
            }

            main {
                background: linear-gradient(140deg, var(--bg-surface) 20%, var(--bg-dark));
                width: 100%;
                height: 100%;
                border-radius: var(--radius);

                display: flex;
                flex-direction: column;
                gap: 6px;
                justify-content: center;
                align-items: center;
                -webkit-app-region: drag;

                overflow: hidden;
            }

            .logo {
                height: 120px;
                width: 120px;
                object-fit: contain;
                filter: drop-shadow(0 0 12px rgba(250, 167, 57, 0.4));
            }

            .title {
                font-size: 1.6em;
                font-weight: bold;
                color: #f0f0ff;
                margin-top: 4px;
            }

            .edition {
                font-size: 0.75em;
                font-weight: 600;
                color: var(--amber);
                text-transform: uppercase;
                letter-spacing: 3px;
            }

            .v {
                opacity: 0.3;
                font-size: 0.8em;
                margin-top: 2px;
            }

            .loader {
                --margin: 1.5px;
                background-color: var(--bg-surface);
                margin: 0 var(--margin);
                border-top-left-radius: 40px;
                border-top-right-radius: 40px;

                position: absolute;
                top: 0;
                width: calc(100% - (var(--margin) * 2));
                height: var(--loader-height);

                overflow: hidden;
            }

            .loader span:before {
                content: "";
                position: absolute;
                height: 100%;
                background-color: var(--crimson);
                animation: first 1.8s infinite ease-out;
            }

            .loader span:after {
                content: "";
                position: absolute;
                height: 100%;
                background-color: var(--amber);
                animation: second 1.8s infinite ease-in;
            }

            @keyframes first {
                0% {
                    inset-inline-start: -100%;
                    width: 80%;
                }
                100% {
                    inset-inline-start: 100%;
                    width: 20%;
                }
            }

            @keyframes second {
                0% {
                    inset-inline-start: -150%;
                    width: 80%;
                }
                100% {
                    inset-inline-start: 100%;
                    width: 20%;
                }
            }
        </style>
    </head>
    <body>
        <div class="loader">
            <span></span>
        </div>

        <main>
            <img class="logo" src="./ccfii-logo.png" alt="CCFII" draggable="false" />

            <div class="title">FreeShow</div>
            <div class="edition">CCFII Edition</div>
            <p class="v">v<span class="version">0.0.0</span></p>
        </main>

        <script>
            const { ipcRenderer } = require("electron")

            ipcRenderer.send("MAIN", { channel: "VERSION" })
            ipcRenderer.once("MAIN", (e, msg) => {
                if (msg.channel !== "VERSION" || !msg.data) return
                document.querySelector(".version").innerHTML = msg.data
            })
        </script>
    </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/loading.html
git commit -m "feat(splash): redesign loading screen with CCFII cinematic branding"
```

---

## Chunk 3: Startup Welcome Screen

### Task 4: Update Splash.svelte with CCFII branding

**Files:**
- Modify: `src/frontend/components/main/Splash.svelte`

- [ ] **Step 1: Add CCFII logo and edition subtitle**

In the `<script>` block, no changes needed (all existing imports and logic stay).

Replace the template section (lines 49-99) — add logo above `h1`, change `h1` to white, add edition subtitle:

```svelte
<Center class="context #splash">
    <img class="ccfii-logo" src="./ccfii-logo.png" alt="CCFII" draggable="false" />
    <h1>FreeShow</h1>
    <p class="edition">CCFII Edition</p>
    <p style="opacity: 0.7;">v{$version}</p>
    {#if $special.splashText}
        <p style="padding-top: 30px">
            {@html extractLinksAndCleanText($special.splashText)}
            <span class="links" style="display: flex;flex-direction: column;align-items: center;">
                {#each links as link}
                    <Link url={link}>
                        {link.replace(/^(https?:\/\/)/, "")}
                        <Icon id="launch" white />
                    </Link>
                {/each}
            </span>
        </p>
    {:else if Object.keys($shows).length < 20}
        <!-- shows up for new users (can be found in "About" menu) -->
        <p style="padding-top: 30px">
            <Link url="https://freeshow.app/docs">
                <T id="main.docs" />
                <Icon id="launch" white />
            </Link>
        </p>
    {:else if votd}
        <p class="votd" style="padding-top: 30px" data-title="Verse of the Day [votd.org]">
            <Link url="https://votd.org/">
                {votd}
            </Link>
        </p>
    {/if}

    <span style="padding-top: 30px" class="buttons">
        <MaterialButton icon="search" title="main.quick_search" on:click={() => quickSearchActive.set(true)}>
            <T id="main.quick_search" />
        </MaterialButton>
        <MaterialButton icon="project" title="tooltip.project" on:click={createProject}>
            <T id="new.project" />
        </MaterialButton>
        <MaterialButton
            icon="add"
            title="tooltip.show"
            on:click={(e) => {
                if (e.detail.ctrl) {
                    history({ id: "UPDATE", newData: { remember: { project: $activeProject } }, location: { page: "show", id: "show" } })
                } else activePopup.set("show")
            }}
        >
            <T id="new.show" />
        </MaterialButton>
    </span>
</Center>
```

- [ ] **Step 2: Add styles for logo and edition subtitle**

Add these rules to the `<style>` block (after the existing `h1` rule):

```css
.ccfii-logo {
    height: 80px;
    width: 80px;
    object-fit: contain;
    filter: drop-shadow(0 0 10px rgba(250, 167, 57, 0.35));
    margin-bottom: 8px;
}

h1 {
    font-size: 4em;
    overflow: initial;
    color: var(--text);
}

.edition {
    font-size: 0.85em;
    font-weight: 600;
    color: #faa739;
    text-transform: uppercase;
    letter-spacing: 3px;
    overflow: initial;
    white-space: nowrap;
}
```

Note: The existing `h1` style block (lines 102-105) must be replaced with the version above that adds `color: var(--text)` to override the default `--secondary` heading color.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/main/Splash.svelte
git commit -m "feat(startup): add CCFII logo and edition branding to welcome screen"
```

---

## Chunk 4: About Dialog

### Task 5: Update About.svelte with CCFII branding

**Files:**
- Modify: `src/frontend/components/main/popups/About.svelte`

- [ ] **Step 1: Replace logo and update title section**

Replace the logo/title div (lines 23-28):

```svelte
<div class="logo">
    <img style="height: 50px;" src="./ccfii-logo.png" alt="CCFII-logo" draggable={false} />
    <div>
        <h1 style="color: var(--text);font-size: 1.7em;">FreeShow</h1>
        <p style="font-size: 0.7em;color: #faa739;text-transform: uppercase;letter-spacing: 2px;white-space: nowrap;">CCFII Edition</p>
    </div>
</div>
```

- [ ] **Step 2: Add CCFII org name below version**

After the version `<p>` tag (line 29-34), add:

```svelte
<p style="font-size: 0.7em;opacity: 0.5;margin-top: 4px;">Christ Charismatic Fellowship Int'l, Inc.</p>
```

- [ ] **Step 3: Add CCFII website link to the links section**

In the `.text` div (around line 44), add a new link entry before the existing ones:

```svelte
<div>
    • CCFII Website
    <Link url="https://ccfii.org/">ccfii.org</Link>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/components/main/popups/About.svelte
git commit -m "feat(about): add CCFII branding to About dialog"
```

---

## Chunk 5: App Identity & Metadata

### Task 6: Update HTML titles

**Files:**
- Modify: `public/index.html:15`

- [ ] **Step 1: Update index.html title**

Change line 15 from:
```html
<title>FreeShow</title>
```
to:
```html
<title>FreeShow - CCFII Edition</title>
```

Note: `loading.html` title was already updated in Task 3.

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat(meta): update page title to FreeShow - CCFII Edition"
```

### Task 7: Update package.json description

**Files:**
- Modify: `package.json:5`

- [ ] **Step 1: Update description field**

Change:
```json
"description": "Show song lyrics and more for free!",
```
to:
```json
"description": "FreeShow - CCFII Edition: Show song lyrics and more for free!",
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat(meta): update package description for CCFII Edition"
```

### Task 8: Update Electron window background color

**Files:**
- Modify: `src/electron/utils/windowOptions.ts:25`

- [ ] **Step 1: Update mainOptions backgroundColor**

Change line 25 from:
```typescript
backgroundColor: "#242832",
```
to:
```typescript
backgroundColor: "#120a0a",
```

- [ ] **Step 2: Commit**

```bash
git add src/electron/utils/windowOptions.ts
git commit -m "feat(electron): update main window background to CCFII dark theme"
```

### Task 9: Update electron-builder config

**Files:**
- Modify: `config/building/electron-builder.yaml:2-3`

- [ ] **Step 1: Update productName and artifactName**

Change:
```yaml
productName: FreeShow
artifactName: FreeShow-${version}-${arch}.${ext}
```
to:
```yaml
productName: FreeShow - CCFII Edition
artifactName: FreeShow-CCFII-${version}-${arch}.${ext}
```

- [ ] **Step 2: Commit**

```bash
git add config/building/electron-builder.yaml
git commit -m "feat(build): update product name and artifact name for CCFII Edition"
```

---

## Chunk 6: App Icons

### Task 10: Generate and replace app icons from CCFII logo

**Files:**
- Replace: `public/icon.png`
- Replace: `public/icon.ico`
- Replace: `public/icon.icns`
- Replace: `public/512x512.png`
- Source: `public/ccfii-logo.png` (658x658 RGBA PNG)

The CCFII logo is a circular badge on a transparent background. We need to composite it onto a dark background (`#120a0a`) for clean icon rendering.

- [ ] **Step 1: Check if ImageMagick or sips is available**

```bash
which magick || which convert || echo "ImageMagick not found, will use sips"
which sips
which iconutil
```

- [ ] **Step 2: Generate icon.png (256x256) and 512x512.png**

Using ImageMagick (preferred):
```bash
cd /Users/solstellar/Documents/ccfii/ccfii-free-show/public

# 512x512 with dark background
magick ccfii-logo.png -resize 512x512 -background "#120a0a" -gravity center -extent 512x512 512x512.png

# 256x256 for general icon
magick ccfii-logo.png -resize 256x256 -background "#120a0a" -gravity center -extent 256x256 icon.png
```

Or using sips (macOS fallback — no background compositing, uses transparent):
```bash
cp ccfii-logo.png 512x512.png
sips -z 512 512 512x512.png
cp ccfii-logo.png icon.png
sips -z 256 256 icon.png
```

- [ ] **Step 3: Generate icon.ico (Windows)**

Using ImageMagick:
```bash
magick ccfii-logo.png -resize 256x256 -background "#120a0a" -gravity center -extent 256x256 icon.ico
```

Or using a PNG-to-ICO conversion tool if ImageMagick is not available.

- [ ] **Step 4: Generate icon.icns (macOS)**

Using `iconutil` (macOS built-in):
```bash
mkdir -p ccfii-icon.iconset
magick ccfii-logo.png -resize 16x16 -background "#120a0a" -gravity center -extent 16x16 ccfii-icon.iconset/icon_16x16.png
magick ccfii-logo.png -resize 32x32 -background "#120a0a" -gravity center -extent 32x32 ccfii-icon.iconset/icon_16x16@2x.png
magick ccfii-logo.png -resize 32x32 -background "#120a0a" -gravity center -extent 32x32 ccfii-icon.iconset/icon_32x32.png
magick ccfii-logo.png -resize 64x64 -background "#120a0a" -gravity center -extent 64x64 ccfii-icon.iconset/icon_32x32@2x.png
magick ccfii-logo.png -resize 128x128 -background "#120a0a" -gravity center -extent 128x128 ccfii-icon.iconset/icon_128x128.png
magick ccfii-logo.png -resize 256x256 -background "#120a0a" -gravity center -extent 256x256 ccfii-icon.iconset/icon_128x128@2x.png
magick ccfii-logo.png -resize 256x256 -background "#120a0a" -gravity center -extent 256x256 ccfii-icon.iconset/icon_256x256.png
magick ccfii-logo.png -resize 512x512 -background "#120a0a" -gravity center -extent 512x512 ccfii-icon.iconset/icon_256x256@2x.png
magick ccfii-logo.png -resize 512x512 -background "#120a0a" -gravity center -extent 512x512 ccfii-icon.iconset/icon_512x512.png
magick ccfii-logo.png -resize 1024x1024 -background "#120a0a" -gravity center -extent 1024x1024 ccfii-icon.iconset/icon_512x512@2x.png
iconutil -c icns ccfii-icon.iconset -o icon.icns
rm -rf ccfii-icon.iconset
```

- [ ] **Step 5: Verify all icons exist and have correct dimensions**

```bash
file public/icon.png public/icon.ico public/icon.icns public/512x512.png
```

Expected: All files exist, PNG files show correct dimensions.

- [ ] **Step 6: Commit**

```bash
git add public/icon.png public/icon.ico public/icon.icns public/512x512.png
git commit -m "feat(icons): replace app icons with CCFII logo"
```

---

## Chunk 7: Verification

### Task 11: Run format and lint checks

- [ ] **Step 1: Run Prettier check**

```bash
npx prettier --config config/formatting/.prettierrc.yaml --check src public/loading.html
```

Expected: All files pass. If not, run `npm run format:prettier` and commit fixes.

- [ ] **Step 2: Run ESLint**

```bash
npm run lint
```

Expected: No new errors introduced.

- [ ] **Step 3: Run Svelte check**

```bash
npx svelte-check
```

Expected: No new type errors.

- [ ] **Step 4: Fix any issues and commit if needed**

```bash
npm run format:prettier
git add -u
git commit -m "fix: format CCFII branding changes"
```

### Task 12: Visual verification (manual)

- [ ] **Step 1: Start the dev environment**

```bash
npm start
```

- [ ] **Step 2: Verify visually**

Check these elements:
1. Loading splash shows CCFII logo with amber glow, centered layout, crimson loader bar
2. Main app background is warm dark (`#120a0a`)
3. Headings use crimson accent (`#810e0e`)
4. Welcome/startup screen shows CCFII logo, "FreeShow" title, "CCFII Edition" subtitle
5. About dialog (Help > About) shows CCFII logo, edition name, org name, ccfii.org link
6. Window title reads "FreeShow - CCFII Edition"
7. Other themes (dark, light, blue, etc.) still work when switched in Settings > Theme
