# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

FreeShow is a free, open-source presentation application built with **Electron + Svelte 5 (legacy mode) + TypeScript**. It displays song lyrics, media, and slideshows on external screens for churches and venues. Licensed under GPL-3.0.

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

2. **Svelte Frontend** (`src/frontend/`) — Renderer process: main UI with Svelte 5 components in legacy mode (`$:`, `export let`, `on:`; no runes in components yet). Entry point `main.ts` mounts `App.svelte` with `mount()`. Global state lives in `stores.ts` as Svelte stores; `outputs`, `media` and `showsCache` are read-only store faces over rune domain modules (`outputState/outputs.svelte.ts`, `mediaState/media.svelte.ts`, `showsCacheState/showsCache.svelte.ts`) built on `createRuneRecordStore`. Write through the module functions (`patchOutput`, `updateOutputs`, ...), never `outputs.set/update`.

3. **Server Apps** (`src/server/`) — Standalone Svelte mini-apps served over HTTP via Express for external access:
   - `remote/` — Mobile remote control
   - `stage/` — Stage monitor display
   - `controller/` — External controller
   - `output_stream/` — Live output streaming
   - `cam/` — Camera feed

### IPC Communication

Most cross-process communication flows through typed channels defined in `src/types/Channels.ts`. The isolated PowerPoint render job uses its private typed bridge in `src/types/PowerPointRenderer.ts`; see [`docs/agents/code-navigation.md`](docs/agents/code-navigation.md) for that route. Channel constants: `MAIN`, `OUTPUT`, `STARTUP`, `EXPORT`, `REMOTE`, `STAGE`, `CONTROLLER`, `OUTPUT_STREAM`, `CLOUD`, `NDI`, `BLACKMAGIC`, `AUDIO`, `API_DATA`.

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

## TypeScript Toolchain

Two TypeScript versions are installed on purpose:
- `typescript` (6.0.3) is the tooling API: svelte-preprocess, typescript-eslint, `@rollup/plugin-typescript`, cosmiconfig. `svelte-check` is v4 and uses it too.
- `typescript7` (npm alias for `typescript@7.0.2`, the native Go compiler) type-checks (`npm run typecheck` or `typecheck:electron|server|frontend`, via `scripts/typecheck.mjs`) and emits the main process (`build:electron:*`). It has no classic compiler API and its `tsc` bin clashes with TS 6's, so it is invoked by path, never through `node_modules/.bin`.
- Main-process emit uses TS 7 (checked: same file list as TS 6, `start.test.ts` launches the app from the TS 7 build). The `build:electron:*` scripts call `node node_modules/typescript7/bin/tsc`.
- `svelte-preprocess` (6.x) only transpiles; it reads `config/typescript/tsconfig.svelte-preprocess*.json`, not the main tsconfigs. That config sets `verbatimModuleSyntax: true`, so type-only imports in `.svelte` files must use `import { type X }`.
- tsconfigs must stay valid for both 6 and 7: no `moduleResolution: node10`, no `importsNotUsedAsValues`, explicit `strict`, explicit `rootDir` for emit. `typecheck` reports existing errors in the server and frontend configs; compare counts, do not assume a clean run.

## Code Style

- Prettier: 4-space indent, no semicolons, double quotes, 500 char print width
- TypeScript with `type` imports enforced (`consistent-type-imports` rule)
- `no-console` restricted to `error`, `warn`, `info`, `assert`, `time`, `timeEnd`
- `prefer-const`, `no-var`, `eqeqeq` (smart)
- Svelte A11y warnings are suppressed in the Vite config
- `@typescript-eslint/no-explicit-any` is off — `any` is used liberally in the codebase

## Code Navigation

For symbol lookups, cross-layer control/output flows, or navigation setup, start with [`docs/agents/code-navigation.md`](docs/agents/code-navigation.md).
For Remote media or Controller presentation UI changes, also use root [`PRODUCT.md`](PRODUCT.md) for the behavior contract and [`DESIGN.md`](DESIGN.md) for the visual authority and scope.
