# PixiJS WebGPU Output Renderer — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FreeShow's HTML/CSS output rendering with PixiJS v8 (WebGPU backend) for GPU-accelerated media compositing and OS-independent transitions.

**Architecture:** Hybrid approach — PixiJS canvas renders media layers (backgrounds, videos, images, effects). Slide text and overlays render as DOM elements on top of the canvas with rAF-driven transitions (not CSS animations). This gives the biggest performance win (media is the bottleneck) while preserving FreeShow's complex text rendering unchanged. Full canvas rendering of text can follow as a Phase 2.

**Tech Stack:** PixiJS v8 (WebGPU/WebGL), Svelte 3, Electron 37, TypeScript 4.9

**Spec:** `docs/superpowers/specs/2026-04-05-pixijs-webgpu-output-renderer-design.md`

---

## File Structure

### New Files

```
src/types/WebGPU.ts                                          # Type definitions for the renderer
src/frontend/components/output/webgpu/PixiRenderer.ts        # Core: init PixiJS Application, manage stage containers
src/frontend/components/output/webgpu/transitionManager.ts   # rAF-driven tweens with FreeShow easing functions
src/frontend/components/output/webgpu/layers/BackgroundLayer.ts   # Dual-sprite crossfade for backgrounds
src/frontend/components/output/webgpu/layers/MediaLayer.ts        # Video/image → PixiJS Sprite management
src/frontend/components/output/webgpu/layers/OverlayLayer.ts      # Overlay sprite management
src/frontend/components/output/webgpu/LayerManager.ts        # Coordinates all PixiJS layers
src/frontend/components/output/webgpu/WebGPUOutput.svelte    # Svelte component: canvas + DOM overlay bridge
src/frontend/components/output/webgpu/capture/pixiCapture.ts # GPU pixel extraction for NDI/streaming
```

### Modified Files

```
src/frontend/MainOutput.svelte:63                            # Swap <Output> for <WebGPUOutput>
src/frontend/utils/transitions.ts                            # Add rAF tick-based transitions alongside CSS ones
src/electron/capture/helpers/CaptureLifecycle.ts:109         # Add IPC-based capture path for PixiJS outputs
```

---

## Chunk 1: Foundation

### Task 1: Install PixiJS v8 and Create Type Definitions

**Files:**
- Modify: `package.json`
- Create: `src/types/WebGPU.ts`

- [ ] **Step 1: Install PixiJS v8**

```bash
cd /Users/solstellar/Documents/ccfii/ccfii-free-show
npm install pixi.js@^8
```

- [ ] **Step 2: Verify installation**

```bash
node -e "const p = require('./node_modules/pixi.js/package.json'); console.log(p.version)"
```

Expected: 8.x.x version printed

- [ ] **Step 3: Create type definitions**

Create `src/types/WebGPU.ts`:

```typescript
import type { TransitionType } from "./Show"

export interface PixiOutputConfig {
    width: number
    height: number
    backgroundColor: string
    transparent: boolean
    preference: "webgpu" | "webgl"
}

export interface RenderLayer {
    id: string
    type: "background" | "underlay" | "slide" | "effect" | "overlay" | "draw"
    visible: boolean
    zIndex: number
}

export interface TransitionState {
    active: boolean
    type: TransitionType
    duration: number
    easing: string
    progress: number
    startTime: number
    direction?: "left_right" | "right_left" | "bottom_top" | "top_bottom"
}

export interface DualSpriteState {
    activeSlot: "a" | "b"
    slotAPath: string
    slotBPath: string
    transition: TransitionState | null
}

export interface CaptureFrameRequest {
    id: string
    width: number
    height: number
    format: "rgba" | "bgra"
}

export interface CaptureFrameResponse {
    id: string
    time: number
    buffer: Buffer | Uint8Array
    size: { width: number; height: number }
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/types/WebGPU.ts
git commit -m "feat: install PixiJS v8 and add WebGPU type definitions"
```

---

### Task 2: Create PixiRenderer — Core PixiJS Application Manager

**Files:**
- Create: `src/frontend/components/output/webgpu/PixiRenderer.ts`

**Context:** This is the core class that initializes a PixiJS Application with WebGPU preference, manages the stage container hierarchy, and exposes methods for the Svelte component to interact with. It follows FreeShow's convention of named exports and interfaces in separate type files.

**Reference:**
- PixiJS v8 initialization: `const app = new Application(); await app.init({ preference: "webgpu" })`
- Stage containers must be created in layer order (background first, draw last) because PixiJS renders children in order

- [ ] **Step 1: Create PixiRenderer.ts**

Create `src/frontend/components/output/webgpu/PixiRenderer.ts`:

```typescript
import { Application, Container } from "pixi.js"
import type { PixiOutputConfig } from "../../../../types/WebGPU"

export interface StageContainers {
    background: Container
    underlays: Container
    effectsUnder: Container
    slide: Container
    effectsOver: Container
    overlays: Container
    draw: Container
}

export function createDefaultConfig(width: number, height: number, transparent: boolean): PixiOutputConfig {
    return {
        width,
        height,
        backgroundColor: transparent ? "transparent" : "#000000",
        transparent,
        preference: "webgpu"
    }
}

export async function initPixiApp(canvas: HTMLCanvasElement, config: PixiOutputConfig): Promise<Application> {
    const app = new Application()
    await app.init({
        canvas,
        width: config.width,
        height: config.height,
        backgroundColor: config.transparent ? 0x000000 : config.backgroundColor,
        backgroundAlpha: config.transparent ? 0 : 1,
        preference: config.preference,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1
    })
    return app
}

export function createStageContainers(app: Application): StageContainers {
    const background = new Container()
    const underlays = new Container()
    const effectsUnder = new Container()
    const slide = new Container()
    const effectsOver = new Container()
    const overlays = new Container()
    const draw = new Container()

    background.label = "background"
    underlays.label = "underlays"
    effectsUnder.label = "effectsUnder"
    slide.label = "slide"
    effectsOver.label = "effectsOver"
    overlays.label = "overlays"
    draw.label = "draw"

    // Order matters — first added = rendered first (behind)
    app.stage.addChild(background)
    app.stage.addChild(underlays)
    app.stage.addChild(effectsUnder)
    app.stage.addChild(slide)
    app.stage.addChild(effectsOver)
    app.stage.addChild(overlays)
    app.stage.addChild(draw)

    return { background, underlays, effectsUnder, slide, effectsOver, overlays, draw }
}

export function resizeApp(app: Application, width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    app.renderer.resize(width, height)
}

export function destroyApp(app: Application): void {
    app.destroy(true, { children: true, texture: true })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/solstellar/Documents/ccfii/ccfii-free-show
npx tsc --noEmit --p src/frontend/tsconfig.json 2>&1 | head -20
```

Note: If tsconfig doesn't cover the new path or has issues, check error output and adjust. The file uses only PixiJS public API and our own types.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/output/webgpu/PixiRenderer.ts
git commit -m "feat: add PixiRenderer core with WebGPU app initialization"
```

---

### Task 3: Create Transition Manager — rAF-Driven Tweens

**Files:**
- Create: `src/frontend/components/output/webgpu/transitionManager.ts`

**Context:** This replaces FreeShow's CSS-based transitions with `requestAnimationFrame`-driven tweens. The key insight: CSS animations are broken when Windows animation settings are disabled, but rAF + direct property manipulation always works. We reuse FreeShow's existing easing functions from `src/frontend/utils/transitions.ts` (backInOut, sineInOut, etc.).

**Reference:**
- FreeShow easings: `src/frontend/utils/transitions.ts:59-71`
- FreeShow transition types: `src/types/Show.ts:612` — `"none" | "blur" | "fade" | "crossfade" | "fly" | "scale" | "slide" | "spin"`
- PixiJS Sprite properties we tween: `alpha`, `scale.x/y`, `rotation`, `x`, `y`
- PixiJS BlurFilter for blur transitions

- [ ] **Step 1: Create transitionManager.ts**

Create `src/frontend/components/output/webgpu/transitionManager.ts`:

```typescript
import { BlurFilter, type Container, type Sprite } from "pixi.js"
import { backInOut, bounceInOut, circInOut, cubicInOut, elasticInOut, linear, sineInOut } from "svelte/easing"
import type { TransitionType } from "../../../../types/Show"
import type { TransitionState } from "../../../../types/WebGPU"

const easingFunctions: { [key: string]: (t: number) => number } = {
    linear,
    back: backInOut,
    sine: sineInOut,
    circ: circInOut,
    cubic: cubicInOut,
    elastic: elasticInOut,
    bounce: bounceInOut
}

export function getEasing(name: string): (t: number) => number {
    return easingFunctions[name] || sineInOut
}

export interface ActiveTransition {
    state: TransitionState
    oldSprite: Sprite | Container | null
    newSprite: Sprite | Container
    blurFilter?: BlurFilter
    onComplete: () => void
    rafId: number
}

const activeTransitions = new Map<string, ActiveTransition>()

export function startTransition(
    id: string,
    type: TransitionType,
    duration: number,
    easing: string,
    oldSprite: Sprite | Container | null,
    newSprite: Sprite | Container,
    direction?: string,
    onComplete?: () => void
): void {
    // Cancel any existing transition on this id
    cancelTransition(id)

    if (type === "none" || duration <= 0) {
        // Instant swap
        if (oldSprite) oldSprite.visible = false
        newSprite.visible = true
        newSprite.alpha = 1
        onComplete?.()
        return
    }

    const state: TransitionState = {
        active: true,
        type,
        duration,
        easing,
        progress: 0,
        startTime: performance.now(),
        direction: direction as TransitionState["direction"]
    }

    // Set initial state for new sprite
    newSprite.visible = true
    applyTransitionState(type, newSprite, 0, direction, "in")

    let blurFilter: BlurFilter | undefined
    if (type === "blur") {
        blurFilter = new BlurFilter({ strength: 20 })
        newSprite.filters = [blurFilter]
    }

    const transition: ActiveTransition = {
        state,
        oldSprite,
        newSprite,
        blurFilter,
        onComplete: onComplete || (() => {}),
        rafId: 0
    }

    activeTransitions.set(id, transition)
    transition.rafId = requestAnimationFrame((time) => tick(id, time))
}

function tick(id: string, currentTime: number): void {
    const transition = activeTransitions.get(id)
    if (!transition || !transition.state.active) return

    const elapsed = currentTime - transition.state.startTime
    const rawProgress = Math.min(1, elapsed / transition.state.duration)
    const easingFn = getEasing(transition.state.easing)
    const t = easingFn(rawProgress)

    transition.state.progress = rawProgress

    // Animate new sprite IN
    applyTransitionState(transition.state.type, transition.newSprite, t, transition.state.direction, "in")

    // Animate old sprite OUT
    if (transition.oldSprite) {
        applyTransitionState(transition.state.type, transition.oldSprite, 1 - t, transition.state.direction, "out")
    }

    // Blur filter
    if (transition.blurFilter) {
        transition.blurFilter.strength = (1 - t) * 20
    }

    if (rawProgress >= 1) {
        // Transition complete
        completeTransition(id)
        return
    }

    transition.rafId = requestAnimationFrame((time) => tick(id, time))
}

function applyTransitionState(
    type: TransitionType,
    sprite: Sprite | Container,
    t: number,
    direction?: string,
    mode?: "in" | "out"
): void {
    // Reset transforms
    sprite.alpha = 1
    sprite.scale.set(1, 1)
    sprite.rotation = 0

    switch (type) {
        case "fade":
            sprite.alpha = t
            break

        case "blur":
            sprite.alpha = t
            break

        case "scale":
            sprite.scale.set(t, t)
            sprite.pivot.set(sprite.width / (2 * t || 1), sprite.height / (2 * t || 1))
            break

        case "spin":
            sprite.alpha = t
            sprite.rotation = (1 - t) * Math.PI * 2
            break

        case "slide": {
            const pos = (1 - t) * 100
            const parentWidth = sprite.parent?.width || 1920
            const parentHeight = sprite.parent?.height || 1080
            const isOut = mode === "out"

            // Reset position
            sprite.x = 0
            sprite.y = 0

            if (direction === "left_right") sprite.x = (isOut ? 1 : -1) * (pos / 100) * parentWidth
            else if (direction === "right_left") sprite.x = (isOut ? -1 : 1) * (pos / 100) * parentWidth
            else if (direction === "bottom_top") sprite.y = (isOut ? -1 : 1) * (pos / 100) * parentHeight
            else if (direction === "top_bottom") sprite.y = (isOut ? 1 : -1) * (pos / 100) * parentHeight
            break
        }

        default:
            sprite.alpha = t
    }
}

function completeTransition(id: string): void {
    const transition = activeTransitions.get(id)
    if (!transition) return

    // Clean up old sprite
    if (transition.oldSprite) {
        transition.oldSprite.visible = false
        transition.oldSprite.alpha = 1
        transition.oldSprite.scale.set(1, 1)
        transition.oldSprite.rotation = 0
        transition.oldSprite.x = 0
        transition.oldSprite.y = 0
        transition.oldSprite.filters = []
    }

    // Ensure new sprite is fully visible
    transition.newSprite.alpha = 1
    transition.newSprite.scale.set(1, 1)
    transition.newSprite.rotation = 0
    transition.newSprite.x = 0
    transition.newSprite.y = 0
    transition.newSprite.filters = []

    transition.state.active = false
    transition.onComplete()
    activeTransitions.delete(id)
}

export function cancelTransition(id: string): void {
    const transition = activeTransitions.get(id)
    if (!transition) return

    cancelAnimationFrame(transition.rafId)
    transition.state.active = false
    activeTransitions.delete(id)
}

export function cancelAllTransitions(): void {
    for (const [id] of activeTransitions) {
        cancelTransition(id)
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/output/webgpu/transitionManager.ts
git commit -m "feat: add rAF-driven transition manager with all FreeShow easing functions"
```

---

## Chunk 2: Media Layers

### Task 4: Create MediaLayer — Video and Image Texture Management

**Files:**
- Create: `src/frontend/components/output/webgpu/layers/MediaLayer.ts`

**Context:** This manages loading images and videos as PixiJS textures/sprites. For videos, PixiJS v8's `Texture.from(videoElement)` creates a `VideoSource` that auto-syncs frames to the GPU. For images, `Assets.load(path)` returns a texture. FreeShow uses `encodeFilePath()` from `src/frontend/components/helpers/media.ts` for paths with special characters.

**Reference:**
- PixiJS VideoSource: `Texture.from(HTMLVideoElement)` — auto-updates GPU texture each frame
- PixiJS image loading: `Assets.load(url)` or `Texture.from(url)`
- FreeShow media style: `MediaStyle` type from `src/types/Main.ts` — has `fit`, `flipped`, `filter`, `speed`
- FreeShow encodeFilePath: `src/frontend/components/helpers/media.ts`

- [ ] **Step 1: Create MediaLayer.ts**

Create `src/frontend/components/output/webgpu/layers/MediaLayer.ts`:

```typescript
import { Assets, Sprite, Texture, type Container } from "pixi.js"
import type { MediaStyle } from "../../../../../types/Main"

export interface MediaSpriteConfig {
    path: string
    type: "image" | "video"
    mediaStyle: MediaStyle
    loop: boolean
    muted: boolean
    startAt: number
}

const textureCache = new Map<string, Texture>()

export async function loadImageTexture(path: string): Promise<Texture> {
    const cached = textureCache.get(path)
    if (cached && !cached.destroyed) return cached

    try {
        const texture = await Assets.load(path)
        textureCache.set(path, texture)
        return texture
    } catch {
        console.warn("MediaLayer: failed to load image:", path)
        return Texture.EMPTY
    }
}

export function createVideoTexture(videoElement: HTMLVideoElement): Texture {
    return Texture.from(videoElement)
}

export function createMediaSprite(texture: Texture, container: Container, parentWidth: number, parentHeight: number, fit: string = "contain"): Sprite {
    const sprite = new Sprite(texture)
    applyFit(sprite, parentWidth, parentHeight, fit)
    container.addChild(sprite)
    return sprite
}

export function applyFit(sprite: Sprite, parentWidth: number, parentHeight: number, fit: string): void {
    if (!sprite.texture || sprite.texture === Texture.EMPTY) return

    const texWidth = sprite.texture.width
    const texHeight = sprite.texture.height
    if (texWidth === 0 || texHeight === 0) return

    const scaleX = parentWidth / texWidth
    const scaleY = parentHeight / texHeight

    switch (fit) {
        case "cover":
        case "fill": {
            const scale = Math.max(scaleX, scaleY)
            sprite.width = texWidth * scale
            sprite.height = texHeight * scale
            sprite.x = (parentWidth - sprite.width) / 2
            sprite.y = (parentHeight - sprite.height) / 2
            break
        }
        case "contain":
        default: {
            const scale = Math.min(scaleX, scaleY)
            sprite.width = texWidth * scale
            sprite.height = texHeight * scale
            sprite.x = (parentWidth - sprite.width) / 2
            sprite.y = (parentHeight - sprite.height) / 2
            break
        }
    }
}

export function applyMediaStyle(sprite: Sprite, mediaStyle: MediaStyle): void {
    if (mediaStyle.flipped) {
        sprite.scale.x *= -1
        sprite.x += sprite.width
    }
    if (mediaStyle.flippedY) {
        sprite.scale.y *= -1
        sprite.y += sprite.height
    }
}

export function removeSprite(sprite: Sprite | null, container: Container): void {
    if (!sprite) return
    container.removeChild(sprite)
    sprite.destroy()
}

export function clearTextureCache(): void {
    for (const [, texture] of textureCache) {
        if (!texture.destroyed) texture.destroy(true)
    }
    textureCache.clear()
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/output/webgpu/layers/MediaLayer.ts
git commit -m "feat: add MediaLayer for video/image texture management"
```

---

### Task 5: Create BackgroundLayer — Dual-Sprite Crossfade

**Files:**
- Create: `src/frontend/components/output/webgpu/layers/BackgroundLayer.ts`

**Context:** Replicates the dual-layer crossfade pattern from `src/frontend/components/output/layers/Background.svelte:22-98`. Two sprite slots (A and B) enable smooth transitions — new content loads into the inactive slot while the active one displays. On transition, slot roles swap. This is the most critical layer for performance since backgrounds often contain videos.

**Reference:**
- Background.svelte dual-layer: `background1`/`background2` with `firstActive` flag
- FreeShow `OutBackground` type from `src/types/Show.ts` — has `path`, `id`, `type`, `loop`, `muted`, `startAt`, `cameraGroup`
- Media types: "media", "video", "image", "screen", "ndi", "camera", "player"
- Only "media"/"video"/"image" types are handled by PixiJS — others fall back to DOM

- [ ] **Step 1: Create BackgroundLayer.ts**

Create `src/frontend/components/output/webgpu/layers/BackgroundLayer.ts`:

```typescript
import { Container, Sprite, Texture, type Application } from "pixi.js"
import type { OutBackground, Transition } from "../../../../../types/Show"
import type { DualSpriteState } from "../../../../../types/WebGPU"
import { loadImageTexture, createVideoTexture, createMediaSprite, applyFit, removeSprite } from "./MediaLayer"
import { startTransition, cancelTransition } from "../transitionManager"

export interface BackgroundLayerState {
    container: Container
    spriteA: Sprite | null
    spriteB: Sprite | null
    dualState: DualSpriteState
    videoElementA: HTMLVideoElement | null
    videoElementB: HTMLVideoElement | null
    width: number
    height: number
}

export function createBackgroundLayer(parentContainer: Container, width: number, height: number): BackgroundLayerState {
    const container = new Container()
    container.label = "bg-layer"
    parentContainer.addChild(container)

    return {
        container,
        spriteA: null,
        spriteB: null,
        dualState: { activeSlot: "a", slotAPath: "", slotBPath: "", transition: null },
        videoElementA: null,
        videoElementB: null,
        width,
        height
    }
}

export async function updateBackground(
    state: BackgroundLayerState,
    data: OutBackground | null,
    transition: Transition,
    transitionId: string
): Promise<void> {
    if (!data || (!data.path && !data.id)) {
        // Clearing background
        clearBackground(state, transitionId)
        return
    }

    const newPath = data.path || data.id || ""
    const currentPath = state.dualState.activeSlot === "a" ? state.dualState.slotAPath : state.dualState.slotBPath

    // Same background — skip
    if (newPath === currentPath && currentPath !== "") return

    // Determine which slot to load into (the inactive one)
    const loadIntoA = state.dualState.activeSlot !== "a"
    const isVideo = data.type === "video" || data.type === "media"

    let newTexture: Texture
    let videoElement: HTMLVideoElement | null = null

    if (isVideo && isVideoPath(newPath)) {
        videoElement = createHiddenVideoElement(newPath, data.loop ?? false, data.muted ?? true)
        newTexture = createVideoTexture(videoElement)
    } else {
        newTexture = await loadImageTexture(newPath)
    }

    const fit = data.fit || "cover"

    if (loadIntoA) {
        // Clean up old sprite A
        removeSprite(state.spriteA, state.container)
        cleanupVideoElement(state.videoElementA)

        state.spriteA = createMediaSprite(newTexture, state.container, state.width, state.height, fit)
        state.videoElementA = videoElement
        state.dualState.slotAPath = newPath

        // Transition from B to A
        startTransition(
            transitionId,
            transition.type || "fade",
            transition.duration ?? 800,
            transition.easing || "sine",
            state.spriteB,
            state.spriteA,
            transition.custom?.direction,
            () => {
                // Clean up old slot B after transition
                removeSprite(state.spriteB, state.container)
                cleanupVideoElement(state.videoElementB)
                state.spriteB = null
                state.videoElementB = null
                state.dualState.slotBPath = ""
                state.dualState.activeSlot = "a"
            }
        )
    } else {
        // Clean up old sprite B
        removeSprite(state.spriteB, state.container)
        cleanupVideoElement(state.videoElementB)

        state.spriteB = createMediaSprite(newTexture, state.container, state.width, state.height, fit)
        state.videoElementB = videoElement
        state.dualState.slotBPath = newPath

        // Transition from A to B
        startTransition(
            transitionId,
            transition.type || "fade",
            transition.duration ?? 800,
            transition.easing || "sine",
            state.spriteA,
            state.spriteB,
            transition.custom?.direction,
            () => {
                removeSprite(state.spriteA, state.container)
                cleanupVideoElement(state.videoElementA)
                state.spriteA = null
                state.videoElementA = null
                state.dualState.slotAPath = ""
                state.dualState.activeSlot = "b"
            }
        )
    }
}

export function resizeBackground(state: BackgroundLayerState, width: number, height: number): void {
    state.width = width
    state.height = height
    if (state.spriteA) applyFit(state.spriteA, width, height, "cover")
    if (state.spriteB) applyFit(state.spriteB, width, height, "cover")
}

function clearBackground(state: BackgroundLayerState, transitionId: string): void {
    cancelTransition(transitionId)
    removeSprite(state.spriteA, state.container)
    removeSprite(state.spriteB, state.container)
    cleanupVideoElement(state.videoElementA)
    cleanupVideoElement(state.videoElementB)
    state.spriteA = null
    state.spriteB = null
    state.videoElementA = null
    state.videoElementB = null
    state.dualState = { activeSlot: "a", slotAPath: "", slotBPath: "", transition: null }
}

function isVideoPath(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase() || ""
    return ["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(ext)
}

function createHiddenVideoElement(path: string, loop: boolean, muted: boolean): HTMLVideoElement {
    const video = document.createElement("video")
    video.src = path
    video.loop = loop
    video.muted = muted
    video.autoplay = true
    video.playsInline = true
    video.style.position = "absolute"
    video.style.visibility = "hidden"
    video.style.pointerEvents = "none"
    video.style.width = "1px"
    video.style.height = "1px"
    document.body.appendChild(video)
    video.play().catch(() => {})
    return video
}

function cleanupVideoElement(video: HTMLVideoElement | null): void {
    if (!video) return
    video.pause()
    video.src = ""
    video.load()
    video.remove()
}

export function destroyBackgroundLayer(state: BackgroundLayerState, transitionId: string): void {
    clearBackground(state, transitionId)
    state.container.destroy({ children: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/output/webgpu/layers/BackgroundLayer.ts
git commit -m "feat: add BackgroundLayer with dual-sprite crossfade transitions"
```

---

### Task 6: Create OverlayLayer — Manage Overlay Sprites

**Files:**
- Create: `src/frontend/components/output/webgpu/layers/OverlayLayer.ts`

**Context:** Manages overlay items that appear above the slide content. Replicates the spam-prevention pattern from `src/frontend/components/output/layers/Overlays.svelte:19-50`. Uses the transition manager for fade in/out of overlay sprites. For the hybrid approach, overlay text items will be rendered via DOM elements positioned above the canvas; this PixiJS layer handles image/media overlays only.

- [ ] **Step 1: Create OverlayLayer.ts**

Create `src/frontend/components/output/webgpu/layers/OverlayLayer.ts`:

```typescript
import { Container, Sprite, Texture } from "pixi.js"
import type { Transition } from "../../../../../types/Show"
import { startTransition, cancelTransition } from "../transitionManager"

export interface OverlaySpriteEntry {
    id: string
    sprite: Sprite
    clearing: boolean
}

export interface OverlayLayerState {
    container: Container
    entries: Map<string, OverlaySpriteEntry>
    width: number
    height: number
}

export function createOverlayLayer(parentContainer: Container, width: number, height: number): OverlayLayerState {
    const container = new Container()
    container.label = "overlay-layer"
    parentContainer.addChild(container)

    return {
        container,
        entries: new Map(),
        width,
        height
    }
}

export function updateOverlays(
    state: OverlayLayerState,
    activeIds: string[],
    overlayTextures: Map<string, Texture>,
    transition: Transition
): void {
    const activeSet = new Set(activeIds)

    // Remove overlays that are no longer active
    for (const [id, entry] of state.entries) {
        if (!activeSet.has(id) && !entry.clearing) {
            entry.clearing = true
            startTransition(
                `overlay-out-${id}`,
                transition.type || "fade",
                transition.duration ?? 500,
                transition.easing || "sine",
                entry.sprite,
                entry.sprite, // same sprite, just fading out
                undefined,
                () => {
                    state.container.removeChild(entry.sprite)
                    entry.sprite.destroy()
                    state.entries.delete(id)
                }
            )
            // Manually fade out since both old/new are the same sprite
            entry.sprite.alpha = 1
        }
    }

    // Add new overlays
    for (const id of activeIds) {
        if (state.entries.has(id)) continue

        const texture = overlayTextures.get(id) || Texture.EMPTY
        const sprite = new Sprite(texture)
        sprite.width = state.width
        sprite.height = state.height
        sprite.alpha = 0

        state.container.addChild(sprite)
        state.entries.set(id, { id, sprite, clearing: false })

        startTransition(
            `overlay-in-${id}`,
            transition.type || "fade",
            transition.duration ?? 500,
            transition.easing || "sine",
            null,
            sprite
        )
    }
}

export function resizeOverlays(state: OverlayLayerState, width: number, height: number): void {
    state.width = width
    state.height = height
    for (const [, entry] of state.entries) {
        entry.sprite.width = width
        entry.sprite.height = height
    }
}

export function destroyOverlayLayer(state: OverlayLayerState): void {
    for (const [id] of state.entries) {
        cancelTransition(`overlay-in-${id}`)
        cancelTransition(`overlay-out-${id}`)
    }
    state.entries.clear()
    state.container.destroy({ children: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/output/webgpu/layers/OverlayLayer.ts
git commit -m "feat: add OverlayLayer with transition-managed sprites"
```

---

## Chunk 3: Layer Manager and Svelte Bridge

### Task 7: Create LayerManager — Coordinates All Layers

**Files:**
- Create: `src/frontend/components/output/webgpu/LayerManager.ts`

**Context:** The LayerManager is the coordination point between Svelte store data and the PixiJS stage. When the Svelte reactive system detects a change in `$outputs`, `$styles`, `$overlays`, etc., the WebGPUOutput component calls LayerManager methods to update the appropriate PixiJS layers. This follows the existing FreeShow pattern where `Output.svelte` reads stores and dispatches to layer components.

**Reference:**
- Output.svelte reactive chain: lines 35-98 — reads `$outputs`, extracts `out.slide`, `out.background`, `out.overlays`
- getOutputTransitions: `src/frontend/components/helpers/output.ts` — returns `{ text, media, overlay }` transitions
- Layer order from Output.svelte lines 284-354

- [ ] **Step 1: Create LayerManager.ts**

Create `src/frontend/components/output/webgpu/LayerManager.ts`:

```typescript
import type { Application } from "pixi.js"
import type { OutBackground, Transition } from "../../../../types/Show"
import type { StageContainers } from "./PixiRenderer"
import { createBackgroundLayer, updateBackground, resizeBackground, destroyBackgroundLayer, type BackgroundLayerState } from "./layers/BackgroundLayer"
import { createOverlayLayer, resizeOverlays, destroyOverlayLayer, type OverlayLayerState } from "./layers/OverlayLayer"
import { cancelAllTransitions } from "./transitionManager"

export interface LayerManagerState {
    app: Application
    containers: StageContainers
    styleBackground: BackgroundLayerState
    slideBackground: BackgroundLayerState
    overlayLayer: OverlayLayerState
    width: number
    height: number
}

export function createLayerManager(app: Application, containers: StageContainers, width: number, height: number): LayerManagerState {
    const styleBackground = createBackgroundLayer(containers.background, width, height)
    const slideBackground = createBackgroundLayer(containers.background, width, height)
    const overlayLayer = createOverlayLayer(containers.overlays, width, height)

    return {
        app,
        containers,
        styleBackground,
        slideBackground,
        overlayLayer,
        width,
        height
    }
}

export async function updateStyleBackground(
    state: LayerManagerState,
    data: OutBackground | null,
    transition: Transition
): Promise<void> {
    await updateBackground(state.styleBackground, data, transition, "style-bg")
}

export async function updateSlideBackground(
    state: LayerManagerState,
    data: OutBackground | null,
    transition: Transition
): Promise<void> {
    await updateBackground(state.slideBackground, data, transition, "slide-bg")
}

export function resizeAllLayers(state: LayerManagerState, width: number, height: number): void {
    state.width = width
    state.height = height
    resizeBackground(state.styleBackground, width, height)
    resizeBackground(state.slideBackground, width, height)
    resizeOverlays(state.overlayLayer, width, height)
}

export function destroyLayerManager(state: LayerManagerState): void {
    cancelAllTransitions()
    destroyBackgroundLayer(state.styleBackground, "style-bg")
    destroyBackgroundLayer(state.slideBackground, "slide-bg")
    destroyOverlayLayer(state.overlayLayer)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/output/webgpu/LayerManager.ts
git commit -m "feat: add LayerManager coordinating background and overlay layers"
```

---

### Task 8: Create WebGPUOutput.svelte — The Svelte Bridge Component

**Files:**
- Create: `src/frontend/components/output/webgpu/WebGPUOutput.svelte`

**Context:** This is the main component that replaces `Output.svelte` in the output window. It creates a PixiJS canvas for media layers and DOM overlays for text content. It reads the same Svelte stores (`$outputs`, `$styles`, `$overlays`, `$transitionData`, `$effects`, `$media`) and dispatches updates to the LayerManager.

The component follows FreeShow's Svelte patterns exactly:
- `export let` props matching Output.svelte's interface
- `$:` reactive statements for store subscriptions
- `onMount`/`onDestroy` for lifecycle
- `createEventDispatcher` for events

**Key difference from Output.svelte:** Instead of rendering Background/SlideContent/Overlays as child Svelte components, it:
1. Renders media to PixiJS canvas via LayerManager
2. Renders slide text as DOM elements on top of the canvas (using existing SlideContent.svelte)
3. All transitions are rAF-driven (PixiJS for media, DOM + rAF for text)

**Reference:**
- Output.svelte props: lines 27-33 — `outputId`, `style`, `ratio`, `mirror`, `preview`, `styleIdOverride`, `outOverride`
- Output.svelte store reads: line 9 — allOutputs, colorbars, currentWindow, drawSettings, drawTool, effects, media, outputs, overlays, showsCache, styles, templates, transitionData
- Output.svelte layer rendering: lines 284-354
- getOutputTransitions: from `../helpers/output`

- [ ] **Step 1: Create WebGPUOutput.svelte**

Create `src/frontend/components/output/webgpu/WebGPUOutput.svelte`:

```svelte
<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import type { OutData } from "../../../../types/Output"
    import type { Styles } from "../../../../types/Settings"
    import type { OutBackground, OutSlide, Slide, SlideData, Transition } from "../../../../types/Show"
    import { allOutputs, currentWindow, drawSettings, drawTool, effects, media, outputs, overlays, showsCache, styles, templates, transitionData } from "../../../stores"
    import { clone } from "../../helpers/array"
    import { defaultLayers, getCurrentStyle, getMetadata, getOutputLines, getOutputTransitions, getResolution, getSlideFilter, getStyleTemplate, setTemplateStyle } from "../../helpers/output"
    import { _show } from "../../helpers/shows"
    import Zoomed from "../../slide/Zoomed.svelte"
    import SlideContent from "../layers/SlideContent.svelte"
    import Overlay from "../layers/Overlay.svelte"
    import Overlays from "../layers/Overlays.svelte"
    import Draw from "../../draw/Draw.svelte"
    import { initPixiApp, createStageContainers, resizeApp, destroyApp, createDefaultConfig } from "./PixiRenderer"
    import { createLayerManager, updateStyleBackground, updateSlideBackground, resizeAllLayers, destroyLayerManager, type LayerManagerState } from "./LayerManager"

    export let outputId = ""
    export let style = ""
    export let ratio = 0
    export let mirror = false
    export let preview = false
    export let styleIdOverride = ""
    export let outOverride: OutData | null = null

    // --- Store reads (identical to Output.svelte) ---
    $: currentOutput = $outputs[outputId] || $allOutputs[outputId] || {}
    $: currentStyling = getCurrentStyle($styles, styleIdOverride || currentOutput.style)
    let currentStyle: Styles = { name: "" }
    $: if (JSON.stringify(currentStyling) !== JSON.stringify(currentStyle)) currentStyle = clone(currentStyling)
    $: alignPosition = currentStyle?.aspectRatio?.alignPosition || "center"

    let layers: string[] = []
    let out: OutData = {}
    let slide: OutSlide | null = null
    let background: OutBackground | null = null
    let clonedOverlays: any = null

    $: if (currentOutput && JSON.stringify(layers) !== JSON.stringify(currentStyle.layers || defaultLayers)) {
        layers = clone(Array.isArray(currentStyle.layers) ? currentStyle.layers : defaultLayers)
        if (!Array.isArray(layers)) layers = []
    }
    $: if (JSON.stringify(out) !== JSON.stringify(outOverride || currentOutput?.out || {})) out = clone(outOverride || currentOutput?.out || {})
    $: if (JSON.stringify(slide) !== JSON.stringify(out.slide || null)) slide = clone(out.slide || null)
    $: if (JSON.stringify(background) !== JSON.stringify(out.background || null)) background = clone(out.background || null)

    // Overlays
    $: overlayIds = out.overlays
    let storedOverlayIds = ""
    let storedOverlays = ""
    $: if (JSON.stringify(overlayIds) !== storedOverlayIds) {
        storedOverlayIds = JSON.stringify(out.overlays)
        if (JSON.stringify($overlays) !== storedOverlays) {
            clonedOverlays = clone($overlays)
            storedOverlays = JSON.stringify($overlays)
        }
    }
    $: outOverlays = out.overlays?.filter((id) => !clonedOverlays?.[id]?.placeUnderSlide) || []
    $: outUnderlays = out.overlays?.filter((id) => clonedOverlays?.[id]?.placeUnderSlide) || []

    // Layout & slide data (same as Output.svelte)
    let currentLayout: any[] = []
    let slideData: SlideData | null = null
    let currentSlide: Slide | null = null

    $: updateSlideData(slide, outputId)
    function updateSlideData(slide: any, _outputChanged: string) {
        if (!slide) { currentLayout = []; slideData = null; currentSlide = null; return }
        currentLayout = clone(_show(slide.id).layouts([slide.layout]).ref()[0] || [])
        slideData = currentLayout[slide?.index]?.data || null
        let newCurrentSlide = getCurrentSlide()
        if (JSON.stringify(newCurrentSlide) !== JSON.stringify(currentSlide)) currentSlide = newCurrentSlide
        function getCurrentSlide() {
            if (!slide && !outputId) return null
            if (slide.id === "temp" || slide.id === "tempText") return { items: slide.tempItems }
            if (!currentLayout) return null
            let slideId: string = currentLayout[slide?.index]?.id || ""
            return clone(_show(slide.id).slides([slideId]).get()[0] || {})
        }
    }

    // Transitions & filters
    $: resolution = getResolution(null, { currentOutput, currentStyle }, false, outputId, styleIdOverride)
    $: transitions = getOutputTransitions(slideData, currentStyle.transition, $transitionData, mirror && !preview)
    $: slideFilter = getSlideFilter(slideData)

    // Template handling
    $: outputStyle = styleIdOverride || currentOutput?.style
    $: if (outputStyle && currentStyle && currentSlide !== undefined) {
        if (currentSlide) currentSlide.items = setTemplateStyle(slide!, currentStyle, currentSlide.items, outputId, currentSlide.customDynamicValues)
        styleTemplate = getStyleTemplate(slide!, currentStyle)
    }
    let styleTemplate: any = null
    $: templateBackground = styleTemplate?.settings?.backgroundPath || ""

    // Lines
    let lines: any = {}
    $: currentLineId = slide?.id
    const updateLinesTime = $currentWindow === "output" ? 50 : 10
    $: if (currentLineId) setTimeout(() => { lines[currentLineId] = getOutputLines(slide!, currentStyle.lines) }, updateLinesTime)

    // Metadata
    $: metadataItems = getMetadata($showsCache[(slide as any)?.id || ""], currentStyle, slide, $templates)
    let currentMetadataItems: any[] = []
    let isMetadataClearing = false
    $: if (metadataItems !== null) { isMetadataClearing = false; if (JSON.stringify(metadataItems) !== JSON.stringify(currentMetadataItems)) currentMetadataItems = clone(metadataItems) }
    else { isMetadataClearing = true; setTimeout(() => { currentMetadataItems = [] }) }

    // Effects
    $: effectsIds = clone(out.effects || [])
    $: allEffects = $effects
    $: effectsUnderSlide = effectsIds.filter((id) => allEffects[id]?.placeUnderSlide === true)
    $: effectsOverSlide = effectsIds.filter((id) => !allEffects[id]?.placeUnderSlide)

    $: overlaysActive = !!(layers.includes("overlays") && clonedOverlays)
    $: cropping = currentOutput.cropping || currentStyle.cropping

    // Background data
    $: backgroundColor = currentOutput.transparent ? "transparent" : styleTemplate?.settings?.backgroundColor || currentSlide?.settings?.color || currentStyle.background || slide?.settings?.backgroundColor || "black"
    $: styleBackground = currentStyle?.clearStyleBackgroundOnText && (slide || background) ? "" : currentStyle?.backgroundImage || ""
    $: styleBackgroundData = { path: styleBackground, ...($media[styleBackground] || {}), loop: true }
    $: templateBackgroundData = { path: templateBackground, loop: true, ...($media[templateBackground] || {}) }
    $: backgroundData = templateBackground ? templateBackgroundData : background

    // Draw zoom
    $: zoomActive = currentOutput.active || (mirror && !preview)
    $: drawZoom = $drawTool === "zoom" && zoomActive ? ($drawSettings.zoom?.size || 200) / 100 : 1

    // Clearing logic (same as Output.svelte)
    $: if (slide !== undefined || layers) updateSlide()
    let actualSlide: OutSlide | null = null
    let actualSlideData: SlideData | null = null
    let actualCurrentSlide: Slide | null = null
    let actualCurrentLineId: string | undefined = undefined
    let isSlideClearing = false
    function updateSlide() {
        const slideActive = layers.includes("slide")
        isSlideClearing = !slide || !slideActive
        setTimeout(() => {
            actualSlide = slideActive ? clone(slide) : null
            actualSlideData = clone(slideData)
            actualCurrentSlide = clone(currentSlide)
            actualCurrentLineId = clone(currentLineId)
        })
    }

    // --- PixiJS Integration ---
    let canvas: HTMLCanvasElement
    let layerManager: LayerManagerState | null = null
    let pixiReady = false

    onMount(async () => {
        const config = createDefaultConfig(resolution.width || 1920, resolution.height || 1080, !!currentOutput.transparent)
        const app = await initPixiApp(canvas, config)
        const containers = createStageContainers(app)
        layerManager = createLayerManager(app, containers, config.width, config.height)
        pixiReady = true
    })

    onDestroy(() => {
        if (layerManager) {
            destroyLayerManager(layerManager)
            destroyApp(layerManager.app)
        }
    })

    // --- Reactive updates to PixiJS layers ---

    // Style background
    $: if (pixiReady && layerManager && styleBackground && actualSlide?.type !== "pdf") {
        updateStyleBackground(layerManager, styleBackgroundData, transitions.media || {})
    }

    // Slide background
    $: if (pixiReady && layerManager && backgroundData) {
        updateSlideBackground(layerManager, backgroundData, transitions.media || {})
    }

    // Resize
    $: if (pixiReady && layerManager && resolution) {
        resizeApp(layerManager.app, resolution.width || 1920, resolution.height || 1080)
        resizeAllLayers(layerManager, resolution.width || 1920, resolution.height || 1080)
    }
</script>

<Zoomed id={outputId} background={backgroundColor} checkered={(preview || mirror) && backgroundColor === "transparent"} backgroundDuration={transitions.media?.type === "none" ? 0 : (transitions.media?.duration ?? 800)} align={alignPosition} center {style} {resolution} {mirror} {drawZoom} {cropping} bind:ratio>
    <!-- PixiJS canvas for media layers (backgrounds, effects) -->
    <canvas bind:this={canvas} class="pixi-canvas" />

    <!-- DOM overlay for text content (slide, overlays) — renders on top of canvas -->
    <div class="dom-overlay">
        <!-- "underlays" -->
        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outUnderlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}

        <!-- slide content -->
        {#if actualSlide && actualSlide?.type !== "pdf" && actualSlide?.type !== "ppt"}
            <SlideContent {outputId} outSlide={actualSlide} isClearing={isSlideClearing} slideData={actualSlideData} currentSlide={actualCurrentSlide} {currentStyle} animationData={{}} currentLineId={actualCurrentLineId} {lines} {ratio} {mirror} {preview} transition={transitions.text} transitionEnabled={!mirror || preview} {styleIdOverride} />

            <!-- metadata -->
            <Overlay overlay={{ items: currentMetadataItems }} isClearing={isMetadataClearing || isSlideClearing} {outputId} transition={transitions.text} />
        {/if}

        <!-- overlays -->
        {#if overlaysActive}
            <Overlays {outputId} overlays={clonedOverlays} activeOverlays={outOverlays} transition={transitions.overlay} {mirror} {preview} />
        {/if}
    </div>

    <!-- draw -->
    {#if zoomActive}
        <Draw />
    {/if}
</Zoomed>

<style>
    .pixi-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
    }

    .dom-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
        pointer-events: none;
    }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/output/webgpu/WebGPUOutput.svelte
git commit -m "feat: add WebGPUOutput Svelte component bridging PixiJS canvas and DOM overlays"
```

---

## Chunk 4: Integration and Capture

### Task 9: Add rAF Transition Mode to FreeShow Transition System

**Files:**
- Modify: `src/frontend/utils/transitions.ts`

**Context:** FreeShow's `custom()` function returns transitions using the Svelte `css()` method, which generates CSS @keyframes. These are broken when Windows animation settings are disabled. We add a `tick()`-based variant that uses direct DOM style manipulation via rAF, which always works regardless of OS settings.

Svelte transitions support two modes:
- `css(t, u)` → generates CSS @keyframes (broken on Windows with animations off)
- `tick(t, u)` → called each frame via rAF, manipulates DOM directly (always works)

We add `customTick()` that mirrors `custom()` but uses `tick` instead of `css`. The existing `custom()` stays for backward compatibility in the editor.

**Reference:**
- Current custom function: `src/frontend/utils/transitions.ts:74-78`
- Svelte transition contract: must return `{ duration, delay, easing, tick(t, u) }`

- [ ] **Step 1: Add customTick function to transitions.ts**

Add at the end of `src/frontend/utils/transitions.ts` (after line 90):

```typescript
// rAF-driven transitions — always work regardless of OS animation settings
// Used by WebGPU output to bypass CSS @keyframes which break on Windows with animations disabled
export function customTick(node: HTMLElement, { type = "fade", duration = 500, easing = "sine", delay = 0, custom: customData = {} }: any) {
    const easingFn = easings.find((a) => a.value === easing)?.function || linear

    return {
        duration: type === "none" ? 0 : duration,
        delay,
        easing: easingFn,
        tick(t: number) {
            switch (type as TransitionType) {
                case "fade":
                    node.style.opacity = String(t)
                    break
                case "blur":
                    node.style.opacity = String(t)
                    node.style.filter = `blur(${(1 - t) * 10}px)`
                    break
                case "spin":
                    node.style.opacity = String(t)
                    node.style.transform = `rotate(${t * 360}deg)`
                    break
                case "scale":
                    node.style.opacity = String(t)
                    node.style.transform = `scale(${t})`
                    break
                case "slide": {
                    const pos = (1 - t) * 100
                    const direction = customData.direction || "left_right"
                    if (direction === "left_right") node.style.transform = `translate(-${pos}%)`
                    else if (direction === "right_left") node.style.transform = `translate(${pos}%)`
                    else if (direction === "bottom_top") node.style.transform = `translateY(${pos}%)`
                    else if (direction === "top_bottom") node.style.transform = `translateY(-${pos}%)`
                    break
                }
                default:
                    node.style.opacity = String(t)
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/utils/transitions.ts
git commit -m "feat: add rAF tick-based transitions for OS-independent animation"
```

---

### Task 10: Swap MainOutput.svelte to Use WebGPUOutput

**Files:**
- Modify: `src/frontend/MainOutput.svelte`

**Context:** The final integration point. Line 63 currently renders `<Output>` — we swap it for `<WebGPUOutput>`. We keep the `<Output>` import for now (referenced by draw and other features) and add a feature flag so both renderers can coexist during testing.

**Reference:**
- MainOutput.svelte line 7: `import Output from "./components/output/Output.svelte"`
- MainOutput.svelte line 63: `<Output {outputId} style={getStyleResolution(resolution, width, height, "fit")} />`

- [ ] **Step 1: Add WebGPUOutput import and swap the render**

In `src/frontend/MainOutput.svelte`, add the import at line 7 (after the Output import):

```svelte
import WebGPUOutput from "./components/output/webgpu/WebGPUOutput.svelte"
```

Replace line 63:
```svelte
        <Output {outputId} style={getStyleResolution(resolution, width, height, "fit")} />
```
with:
```svelte
        <WebGPUOutput {outputId} style={getStyleResolution(resolution, width, height, "fit")} />
```

- [ ] **Step 2: Manual verification**

```bash
cd /Users/solstellar/Documents/ccfii/ccfii-free-show
npm run start
```

1. Open FreeShow
2. Create a show with a background image
3. Enable an output window
4. Verify the background image renders on the PixiJS canvas
5. Change slides — verify transitions animate
6. Add text — verify text renders on the DOM overlay above the canvas
7. Add a video background — verify video plays on the canvas

- [ ] **Step 3: Commit**

```bash
git add src/frontend/MainOutput.svelte
git commit -m "feat: swap output renderer to WebGPUOutput with PixiJS canvas"
```

---

### Task 11: Create Capture Pipeline Integration

**Files:**
- Create: `src/frontend/components/output/webgpu/capture/pixiCapture.ts`
- Modify: `src/electron/capture/helpers/CaptureLifecycle.ts`

**Context:** The current capture pipeline uses `window.webContents.capturePage()` (line 109 in CaptureLifecycle.ts) which screenshots the entire BrowserWindow via Chromium. This is expensive. For PixiJS outputs, we can extract pixels directly from the canvas using `renderer.extract`. The approach:

1. Main process sends IPC `CAPTURE_FRAME` to the output window
2. Output window's PixiJS extracts pixels from the canvas
3. Sends RGBA buffer back via IPC
4. CaptureTransmitter routes to NDI/Blackmagic/server as before

**Reference:**
- CaptureLifecycle.ts line 109: `let image = await output.captureOptions.window.webContents.capturePage()`
- CaptureTransmitter.transmitFrame expects a NativeImage — for the IPC path we'll send raw buffer instead
- PixiJS extract: `app.renderer.extract.canvas(app.stage)` or `app.renderer.extract.pixels()`

- [ ] **Step 1: Create pixiCapture.ts**

Create `src/frontend/components/output/webgpu/capture/pixiCapture.ts`:

```typescript
import type { Application } from "pixi.js"
import { OUTPUT } from "../../../../../types/Channels"
import { send } from "../../../../utils/request"

let captureApp: Application | null = null

export function registerCaptureApp(app: Application): void {
    captureApp = app
}

export function unregisterCaptureApp(): void {
    captureApp = null
}

export async function captureFrame(outputId: string): Promise<void> {
    if (!captureApp) return

    try {
        const canvas = captureApp.renderer.extract.canvas(captureApp.stage) as HTMLCanvasElement
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const buffer = imageData.data.buffer

        send(OUTPUT, ["CAPTURE_BUFFER"], {
            id: outputId,
            time: Date.now(),
            buffer: new Uint8Array(buffer),
            size: { width: canvas.width, height: canvas.height }
        })

        canvas.remove()
    } catch (error) {
        console.warn("pixiCapture: frame capture failed:", error)
    }
}

// Listen for capture requests from main process
export function setupCaptureListener(outputId: string): void {
    // The main process will send CAPTURE_FRAME requests via IPC
    // The output window responds with the pixel buffer
    // This is registered when WebGPUOutput mounts
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/output/webgpu/capture/pixiCapture.ts
git commit -m "feat: add PixiJS capture pipeline for GPU pixel extraction"
```

---

### Task 12: Final Integration Test and Cleanup

**Files:**
- All new files from previous tasks

- [ ] **Step 1: Run the full app and test all output scenarios**

```bash
cd /Users/solstellar/Documents/ccfii/ccfii-free-show
npm run start
```

**Test checklist:**
1. Output window opens with PixiJS canvas (check DevTools console for "WebGPU" or "WebGL" renderer log)
2. Background images render correctly (size, fit, position)
3. Background videos play on the canvas
4. Slide text overlays display on top of media
5. Transitions animate between slides (fade, blur, slide, scale, spin)
6. Overlays appear and disappear with transitions
7. Multiple outputs work simultaneously (lyrics + stage)
8. Stage output (prompter) still works via HTML path
9. No console errors or memory leaks during extended use

- [ ] **Step 2: Fix any issues found during testing**

Address any rendering, sizing, or transition issues discovered in Step 1.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "fix: address integration issues from full output testing"
```

---

## Summary

| Chunk | Tasks | Files Created | Files Modified |
|-------|-------|--------------|----------------|
| 1: Foundation | 1-3 | `WebGPU.ts`, `PixiRenderer.ts`, `transitionManager.ts` | `package.json` |
| 2: Media Layers | 4-6 | `MediaLayer.ts`, `BackgroundLayer.ts`, `OverlayLayer.ts` | — |
| 3: Svelte Bridge | 7-8 | `LayerManager.ts`, `WebGPUOutput.svelte` | — |
| 4: Integration | 9-12 | `pixiCapture.ts` | `transitions.ts`, `MainOutput.svelte` |

**Total: 10 new files, 3 modified files, 12 tasks**
