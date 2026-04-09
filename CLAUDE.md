# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FreeShow is a free, open-source presentation application built with **Electron + Svelte 3 + TypeScript**. It displays song lyrics, media, and slideshows on external screens for churches and venues. Licensed under GPL-3.0.

## Common Commands

### Development
```bash
npm start              # Full dev environment (Vite + Electron + server watch)
npm run build          # Production build (frontend → servers → electron)
```

### Testing
```bash
npm test                                                    # All checks (playwright + format + svelte-check)
npx playwright test --config config/testing/playwright.config.ts  # E2E tests only
npx prettier --config config/formatting/.prettierrc.yaml --check src scripts  # Format check
svelte-check                                                # Svelte type checking
```

### Linting
```bash
npm run lint              # All linters (electron + frontend + svelte + styles)
npm run lint:electron     # ESLint for src/electron
npm run lint:frontend     # ESLint for src/frontend (.js,.ts)
npm run lint:svelte       # ESLint for src/frontend (.svelte)
npm run lint:styles       # Stylelint for CSS/SCSS/Svelte
```

### Formatting
```bash
npm run format:prettier   # Auto-format src and scripts
```

## Architecture

### Process Model (3 layers)

1. **Electron Main Process** (`src/electron/`) — Node.js backend: window management, file I/O, native integrations (NDI, Blackmagic, MIDI/LTC timecode, audio capture), output window lifecycle, cloud sync, content providers.

2. **Svelte Frontend** (`src/frontend/`) — Renderer process: main UI with Svelte 3 components. Entry point `main.ts` → `App.svelte`. Global state lives in `stores.ts` as Svelte writable stores (not a state management library).

3. **Server Apps** (`src/server/`) — Standalone Svelte mini-apps served over HTTP via Express for external access:
   - `remote/` — Mobile remote control
   - `stage/` — Stage monitor display
   - `controller/` — External controller
   - `output_stream/` — Live output streaming
   - `cam/` — Camera feed

### IPC Communication

All cross-process communication flows through typed IPC channels defined in `src/types/Channels.ts`. Channel constants: `MAIN`, `OUTPUT`, `STARTUP`, `EXPORT`, `REMOTE`, `STAGE`, `CONTROLLER`, `OUTPUT_STREAM`, `CLOUD`, `NDI`, `BLACKMAGIC`, `AUDIO`, `API_DATA`.

- `src/types/IPC/` — Message type definitions (`Main.ts` enumerates main-channel message IDs, `ToMain.ts` for reverse direction)
- `src/electron/IPC/main.ts` + `responsesMain.ts` — Electron-side handlers
- `src/frontend/IPC/main.ts` + `responsesMain.ts` — Frontend-side handlers

### Output System

`src/electron/output/` manages presentation output windows. `OutputHelper` delegates to specialized helpers: `OutputLifecycle`, `OutputBounds`, `OutputVisibility`, `OutputSend`, `OutputValues`, `OutputIdentify`. The capture system (`src/electron/capture/`) handles screen recording and preview thumbnails.

### Type System

`src/types/` contains shared type definitions used across all processes (Output, Show, Main, Settings, Stage, etc.). Types are organized by domain, not by process.

### Shared Code

`src/common/` contains utilities shared between electron and frontend processes (currently scripture-related).

### Format Converters

`src/frontend/converters/` — Import parsers for external presentation formats: ProPresenter, EasyWorship, OpenLP, OpenSong, PowerPoint, SongBeamer, MediaShout, VideoPsalm, and various Bible formats.

## Configuration Layout

All configs live under `config/`:
- `typescript/` — Separate tsconfig files for electron, svelte, and server
- `linting/` — ESLint configs (separate for electron, frontend JS/TS, and Svelte files)
- `formatting/` — Prettier config (`.prettierrc.yaml`)
- `testing/` — Playwright config
- `building/` — electron-builder YAML configs

## Code Style

- Prettier: 4-space indent, no semicolons, double quotes, 500 char print width
- TypeScript with `type` imports enforced (`consistent-type-imports` rule)
- `no-console` restricted to `error`, `warn`, `info`, `assert`, `time`, `timeEnd`
- `prefer-const`, `no-var`, `eqeqeq` (smart)
- Svelte A11y warnings are suppressed in the Vite config
- `@typescript-eslint/no-explicit-any` is off — `any` is used liberally in the codebase

## CCFII Fork-Specific Notes

### Branding
This is "FreeShow - CCFII Edition" — a theme-level rebrand, not a full replacement. CCFII branding lives in the default theme (`defaultThemes.ts`), CSS variables (`global.css`), loading screen (`loading.html`), startup screen (`Splash.svelte`), about dialog (`About.svelte`), and top bar (`Top.svelte`). All original FreeShow credits are preserved.

### Build & Release
- **Two builder configs**: `electron-builder.yaml` (signed/external) and `electron-builder.internal.js` (unsigned/internal). Both must be kept in sync for branding fields (`productName`, `artifactName`).
- **`package.json` `repository` field** must point to `ccfii-engineering/ccfii-free-show` — electron-builder uses this to determine the GitHub Releases target.
- **macOS unsigned builds require `identity: null`** in the electron-builder config. Without it, electron-builder attempts code signing and fails with "not a file."
- **macOS `icon.png` must be at least 512x512** — electron-builder enforces this for DMG builds.
- **CI workflow must run `npm run build` before electron-builder** — the release scripts (`release:internal`, `release`) only run electron-builder packaging, they do NOT compile TypeScript/Svelte. The build step produces `build/electron/index.js` which is the app entry point.
- **No Linux builds** — dropped from CI, not needed for CCFII.
- **Auto-updates**: Disabled on macOS for internal (unsigned) builds via `updateSupport.ts`. May work on Windows. Users update manually via GitHub Releases.
- **Workflow permissions**: `release.yml` needs `permissions: contents: write` for `GITHUB_TOKEN` to create GitHub Releases.

### Theme Migration
When changing default theme colors, update the migration check in `src/frontend/utils/updateSettings.ts` (around line 149). The app persists theme settings — without a migration, existing users keep old colors even after the code changes. Match on old color values to trigger a reset to `defaultThemes.default`.

## Using Serena (MCP)

This project is registered with Serena. **Prefer Serena's semantic tools over generic file reads/greps** — this codebase is large (Electron + Svelte + multiple server apps + converters for many presentation formats) and blind file reads waste context fast.

### Always start a session with
1. `mcp__serena__check_onboarding_performed` — verify Serena is active for `ccfii-free-show`.
2. `mcp__serena__list_memories` + `mcp__serena__read_memory` — load the relevant memory files before exploring. Key memories: `project_overview`, `codebase_structure`, `suggested_commands`, `code_style_conventions`, `task_completion_checklist`, `ccfii_fork_notes`.

### Preferred tool mapping
Use Serena's symbolic tools as the default; fall back to `Read`/`Grep`/`Glob` only when symbolic access isn't possible (non-code files, config, markdown).

| Task | Use |
|---|---|
| Understand a file's shape before reading it | `mcp__serena__get_symbols_overview` |
| Find a class/function/method by name | `mcp__serena__find_symbol` (with `name_path`, `include_body` only when needed) |
| Find all callers/usages of a symbol | `mcp__serena__find_referencing_symbols` |
| Fuzzy search for a pattern across the repo | `mcp__serena__search_for_pattern` |
| Locate a file by name | `mcp__serena__find_file` |
| Edit a function/class body wholesale | `mcp__serena__replace_symbol_body` |
| Insert code near an existing symbol | `mcp__serena__insert_before_symbol` / `insert_after_symbol` |
| Rename a symbol across the project | `mcp__serena__rename_symbol` |
| Delete a symbol safely | `mcp__serena__safe_delete_symbol` |

**Do not** read entire files (e.g. `App.svelte`, large converters, `stores.ts`) just to find one function — use `get_symbols_overview` then `find_symbol` with a targeted `name_path`. Only read symbol bodies when you actually need to edit or fully understand them.

### Writing memories
When you learn something durable about the codebase (non-obvious patterns, gotchas, cross-cutting conventions), save it with `mcp__serena__write_memory` so future sessions benefit. Update existing memories rather than creating duplicates. Memories live in `.serena/memories/` and persist across conversations for this project.

### Scoping searches
Always pass `relative_path` to Serena tools when you know the area (e.g. `src/electron/output`, `src/frontend/converters`) — this keeps the token cost of symbolic operations bounded.
