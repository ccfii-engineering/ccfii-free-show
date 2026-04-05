# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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
