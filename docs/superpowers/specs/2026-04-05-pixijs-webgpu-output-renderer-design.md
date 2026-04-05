# PixiJS WebGPU Output Renderer — Design Spec

**Date:** 2026-04-05
**Status:** Approved
**Repository:** ccfii-engineering/ccfii-free-show (fork of ChurchApps/FreeShow v1.6.0-beta.3)

## Problem

FreeShow's output rendering uses HTML/CSS inside Electron BrowserWindows. Each output (lyrics, prompter) spawns a full Chromium renderer process. This causes:

1. **High CPU/memory** — two outputs = two Chromium renderers compositing DOM layers
2. **Broken transitions** — CSS animations depend on the Windows compositor. When Windows animations are disabled (performance mode / accessibility), output transitions snap instead of animating
3. **Slow capture** — `webContents.capturePage()` screenshots the entire BrowserWindow for NDI/streaming, causing 14-18 FPS drops
4. **Multi-output sync lag** — sequential IPC to separate BrowserWindows causes ~1 second stagger

## Solution

Replace the HTML/CSS rendering inside output BrowserWindows with PixiJS v8 using the WebGPU backend. The editor UI, IPC channels, Svelte stores, and data model remain untouched.

## Target Environment

- Windows PC with dedicated GPU (NVIDIA/AMD)
- Electron 37 (Chromium with WebGPU support)
- Two simultaneous outputs: lyrics + prompter (stage display)

## Architecture

### What stays the same

- Electron app structure, main process, BrowserWindows
- All IPC channels (OUTPUT, OUTPUTS, etc.) — data flows identically
- Svelte stores ($outputs, $styles, $overlays, $transitionData, etc.)
- Entire editor UI (main window)
- OutputHelper, OutputLifecycle, OutputSend, OutputBounds — untouched
- StageLayout (prompter) — initially kept as HTML, migrated later if needed

### What changes

- `MainOutput.svelte` line 63: `<Output>` swapped for `<WebGPUOutput>`
- Output rendering moves from DOM elements to a single PixiJS `<canvas>` per output window
- CSS transitions replaced by PixiJS sprite property tweens + filters
- Capture pipeline uses `renderer.extract.pixels()` instead of `webContents.capturePage()`

### Swap Point

```svelte
<!-- MainOutput.svelte line 63 -->
<!-- BEFORE -->
<Output {outputId} style={getStyleResolution(resolution, width, height, "fit")} />

<!-- AFTER -->
<WebGPUOutput {outputId} style={getStyleResolution(resolution, width, height, "fit")} />
```

## Why PixiJS v8

- Native WebGPU backend with automatic WebGL fallback
- Built-in VideoSource — handles video-to-GPU-texture automatically
- Built-in filters: BlurFilter, ColorMatrixFilter, AlphaFilter
- Sprite/Container hierarchy maps directly to FreeShow's layer model
- 233% CPU improvement over v7 for moving sprites, reactive render loop
- Blend modes and tints inherit through the display hierarchy
- Works in Electron out of the box
- Eliminates need for manual WGSL shader code for ~90% of use cases

## Layer Mapping

FreeShow's output layers map to PixiJS containers:

```
PixiJS Stage (Application)
+-- Container: "background"
|   +-- Sprite (style background image/video)
|   +-- Sprite (slide background image/video)
+-- Container: "underlays"
|   +-- Sprite per underlay overlay
+-- Container: "slide"
|   +-- Sprite (pre-rendered slide text from OffscreenCanvas)
+-- Container: "effects"
|   +-- Sprite per effect (with PixiJS filters)
+-- Container: "overlays"
|   +-- Sprite per overlay
+-- Container: "draw"
    +-- Graphics (draw tool annotations)
```

## Transition System

All transitions are PixiJS sprite property tweens driven by `requestAnimationFrame` with FreeShow's existing easing functions. Completely independent of Windows animation settings.

| FreeShow Type | PixiJS Implementation |
|---|---|
| fade | Tween `sprite.alpha` 0 to 1 (old layer 1 to 0) |
| blur | Apply BlurFilter, tween strength 20 to 0 |
| scale | Tween `sprite.scale` 0 to 1 from center |
| spin | Tween `sprite.rotation` PI to 0 + alpha |
| slide | Tween `sprite.x` or `sprite.y` from offscreen to 0 |
| none | Instant sprite swap |

Easing functions (sine, back, circ, cubic, elastic, bounce) are computed CPU-side and applied to the tween progress value, matching FreeShow's existing behavior.

### Dual-Layer Crossfade

Replicates the existing Background.svelte pattern:
- Two sprite slots (A and B) per layer type
- On content change: new content loads into inactive slot, transition starts
- When complete, old slot is released and roles swap

Per-layer transition control is preserved:
- `transitions.text` — applied to slide content sprite
- `transitions.media` — applied to background/media sprite
- `transitions.overlay` — applied to overlay sprites

## Video Handling

```typescript
const videoTexture = Texture.from(videoElement)
const videoSprite = new Sprite(videoTexture)
backgroundContainer.addChild(videoSprite)
```

PixiJS VideoSource automatically syncs video frames to the GPU texture. The HTMLVideoElement stays in the DOM (hidden) for decoding. Configurable FPS update rate to balance quality vs performance.

## Text Rendering

Slide text items are pre-rendered to an OffscreenCanvas (replicating FreeShow's existing text layout with styles, fonts, line spacing), then uploaded as a PixiJS texture:

```typescript
const canvas = renderSlideToCanvas(slideItems, styles)
const texture = Texture.from(canvas)
slideSprite.texture = texture
```

This preserves all existing text formatting (fonts, colors, shadows, outlines) without needing PixiJS text rendering.

## Capture Pipeline

### Before
```
Main process -> capturePage() -> NativeImage -> CaptureTransmitter
```

### After
```
Main process -> IPC "CAPTURE_FRAME" -> Output window -> renderer.extract.pixels() -> IPC buffer -> CaptureTransmitter
```

CaptureTransmitter stays untouched — it still receives RGBA buffers and routes to NDI/Blackmagic/server.

## Data Flow

```
User clicks next slide
    |
setOutput() -> $outputs store update
    |
IPC send(OUTPUT, ["OUTPUTS"], data)
    |
Electron main -> OutputSend -> webContents.send
    |
Output window receives -> stores update
    |
WebGPUOutput.svelte reactive ($:) triggers
    |
PixiRenderer reads new state -> updates sprites/textures
    |
LayerManager composites layers on PixiJS stage
    |
transitionManager tweens between old/new content
    |
PixiJS renders to <canvas> via WebGPU
```

## New Files

```
src/frontend/components/output/webgpu/
+-- WebGPUOutput.svelte          # PixiJS Application canvas, Svelte reactive bridge
+-- PixiRenderer.ts              # Init PixiJS app, manage stage containers, render loop
+-- LayerManager.ts              # Map FreeShow layers to PixiJS containers
+-- layers/
|   +-- BackgroundLayer.ts       # Dual-sprite crossfade for backgrounds
|   +-- SlideLayer.ts            # Pre-render slide text -> OffscreenCanvas -> Sprite
|   +-- OverlayLayer.ts          # Manage overlay sprites with clearing state
|   +-- MediaLayer.ts            # Video/image sprite management
+-- transitions/
|   +-- transitionManager.ts     # Tween sprite properties (alpha, scale, position, rotation, blur)
+-- capture/
    +-- pixiCapture.ts           # renderer.extract.pixels() for NDI/streaming

src/types/
+-- WebGPU.ts                    # Interfaces: RenderLayer, TransitionState, PixiOutputConfig
```

## Existing Files Modified

| File | Change |
|---|---|
| `src/frontend/MainOutput.svelte` | Line 63: swap `<Output>` for `<WebGPUOutput>` |
| `src/electron/capture/helpers/CaptureLifecycle.ts` | Replace `capturePage()` with IPC-based pixel extraction |
| `src/frontend/stores.ts` | Add new stores if needed (likely none) |

## Conventions

Following FreeShow's existing codebase patterns:
- PascalCase for Svelte components and type files
- camelCase for utility/helper files
- Interfaces (not type aliases) for all data structures in `src/types/`
- Named exports only (no default exports in helper files)
- Svelte props via `export let`, reactive via `$:`, events via `createEventDispatcher`
- Relative imports, no barrel files
- Global stores in `src/frontend/stores.ts`
- `import type` for type-only imports

## Open Questions

1. **StageLayout migration** — prompter output currently stays as HTML. Should this be migrated to PixiJS in a follow-up phase?
2. **PPT/PDF output** — these special output types (lines 312-321 in Output.svelte) may need separate handling or can stay as HTML overlays initially.
3. **Draw tool** — the Draw component uses Canvas 2D. Could be migrated to PixiJS Graphics in a follow-up.
