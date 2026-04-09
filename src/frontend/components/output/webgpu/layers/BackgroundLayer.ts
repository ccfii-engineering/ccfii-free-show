import { Container, Sprite, Texture } from "pixi.js"
import type { OutBackground, Transition } from "../../../../../types/Show"
import type { DualSpriteState } from "../../../../../types/WebGPU"
import { loadImageTexture, createVideoTexture, createMediaSprite, applyFit, removeSprite } from "./MediaLayer"
import { startTransition, cancelTransition } from "../transitionManager"

export type VideoTimeCallback = (info: { currentTime: number; duration: number; paused: boolean }) => void

export interface BackgroundLayerState {
    container: Container
    spriteA: Sprite | null
    spriteB: Sprite | null
    dualState: DualSpriteState
    videoElementA: HTMLVideoElement | null
    videoElementB: HTMLVideoElement | null
    fitA: string
    fitB: string
    sourceWidthA: number
    sourceHeightA: number
    sourceWidthB: number
    sourceHeightB: number
    width: number
    height: number
    videoTimeHandler: VideoTimeCallback | null
}

export function createBackgroundLayer(parentContainer: Container, width: number, height: number, videoTimeHandler: VideoTimeCallback | null = null): BackgroundLayerState {
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
        fitA: "cover",
        fitB: "cover",
        sourceWidthA: 0,
        sourceHeightA: 0,
        sourceWidthB: 0,
        sourceHeightB: 0,
        width,
        height,
        videoTimeHandler
    }
}

export async function updateBackground(state: BackgroundLayerState, data: OutBackground | null, transition: Transition, transitionId: string): Promise<void> {
    if (!data || (!data.path && !data.id)) {
        clearBackground(state, transitionId)
        return
    }

    const newPath = data.path || data.id || ""
    const fit = data.fit || "contain"

    // Determine which slot is currently "active" (the visible one)
    const currentIsA = state.dualState.activeSlot === "a"
    const currentPath = currentIsA ? state.dualState.slotAPath : state.dualState.slotBPath
    const currentFit = currentIsA ? state.fitA : state.fitB
    const currentSprite = currentIsA ? state.spriteA : state.spriteB

    // Same-path short-circuit: hoisted ABOVE resource allocation + cancelTransition.
    // Reactive callers (WebGPUOutput.svelte) re-invoke updateBackground whenever ANY transition
    // field changes (including text/overlay). Without this early check, each text-transition edit
    // leaks a hidden video element and cancels in-progress media transitions.
    if (newPath === currentPath && currentPath !== "") {
        if (currentSprite && currentFit !== fit) {
            applyFit(currentSprite, state.width, state.height, fit, currentIsA ? state.sourceWidthA : state.sourceWidthB, currentIsA ? state.sourceHeightA : state.sourceHeightB)
            if (currentIsA) state.fitA = fit
            else state.fitB = fit
        }
        return
    }

    const isVideo = data.type === "video" || data.type === "media"

    let newTexture: Texture
    let videoElement: HTMLVideoElement | null = null
    let srcW: number = 0
    let srcH: number = 0

    if (isVideo && isVideoPath(newPath)) {
        videoElement = createHiddenVideoElement(newPath, data.loop ?? false, data.muted ?? true)
        if (state.videoTimeHandler) attachVideoTimeListeners(videoElement, state.videoTimeHandler)
        await waitForVideoReady(videoElement)
        newTexture = createVideoTexture(videoElement)
        srcW = videoElement.videoWidth
        srcH = videoElement.videoHeight
    } else {
        const loaded = await loadImageTexture(toFileUrl(newPath))
        newTexture = loaded.texture
        srcW = loaded.width
        srcH = loaded.height
    }

    // After async gap: cancel any in-progress transition and clean up stale state
    cancelTransition(transitionId)

    // Clean up the non-active slot (may have an orphaned sprite from a cancelled transition)
    if (currentIsA) {
        removeSprite(state.spriteB, state.container)
        cleanupVideoElement(state.videoElementB)
        state.spriteB = null
        state.videoElementB = null
        state.fitB = "cover"
        state.sourceWidthB = 0
        state.sourceHeightB = 0
        state.dualState.slotBPath = ""
    } else {
        removeSprite(state.spriteA, state.container)
        cleanupVideoElement(state.videoElementA)
        state.spriteA = null
        state.videoElementA = null
        state.fitA = "cover"
        state.sourceWidthA = 0
        state.sourceHeightA = 0
        state.dualState.slotAPath = ""
    }

    // Reset visual state of the current sprite (may be mid-transition)
    if (currentSprite) {
        currentSprite.alpha = 1
        currentSprite.visible = true
        currentSprite.rotation = 0
        currentSprite.filters = []
    }

    // Create new sprite in the non-active slot
    if (currentIsA) {
        state.spriteB = createMediaSprite(newTexture, state.container, state.width, state.height, fit, srcW, srcH)
        state.videoElementB = videoElement
        state.fitB = fit
        state.sourceWidthB = srcW
        state.sourceHeightB = srcH
        state.dualState.slotBPath = newPath

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
                state.fitA = "cover"
                state.sourceWidthA = 0
                state.sourceHeightA = 0
                state.dualState.slotAPath = ""
                state.dualState.activeSlot = "b"
            },
            state.width,
            state.height
        )
    } else {
        state.spriteA = createMediaSprite(newTexture, state.container, state.width, state.height, fit, srcW, srcH)
        state.videoElementA = videoElement
        state.fitA = fit
        state.sourceWidthA = srcW
        state.sourceHeightA = srcH
        state.dualState.slotAPath = newPath

        startTransition(
            transitionId,
            transition.type || "fade",
            transition.duration ?? 800,
            transition.easing || "sine",
            state.spriteB,
            state.spriteA,
            transition.custom?.direction,
            () => {
                removeSprite(state.spriteB, state.container)
                cleanupVideoElement(state.videoElementB)
                state.spriteB = null
                state.videoElementB = null
                state.fitB = "cover"
                state.sourceWidthB = 0
                state.sourceHeightB = 0
                state.dualState.slotBPath = ""
                state.dualState.activeSlot = "a"
            },
            state.width,
            state.height
        )
    }
}

export function resizeBackground(state: BackgroundLayerState, width: number, height: number): void {
    state.width = width
    state.height = height
    if (state.spriteA) applyFit(state.spriteA, width, height, state.fitA, state.sourceWidthA || state.videoElementA?.videoWidth, state.sourceHeightA || state.videoElementA?.videoHeight)
    if (state.spriteB) applyFit(state.spriteB, width, height, state.fitB, state.sourceWidthB || state.videoElementB?.videoWidth, state.sourceHeightB || state.videoElementB?.videoHeight)
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
    state.fitA = "cover"
    state.fitB = "cover"
    state.sourceWidthA = 0
    state.sourceHeightA = 0
    state.sourceWidthB = 0
    state.sourceHeightB = 0
    state.dualState = { activeSlot: "a", slotAPath: "", slotBPath: "", transition: null }
}

function toFileUrl(path: string): string {
    if (!path || path.startsWith("http") || path.startsWith("file://") || path.startsWith("blob:") || path.startsWith("data:")) return path
    // Local filesystem path — Electron needs file:// protocol
    if (path.startsWith("/")) return `file://${path}`
    return path
}

function isVideoPath(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase() || ""
    return ["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(ext)
}

function createHiddenVideoElement(path: string, loop: boolean, muted: boolean): HTMLVideoElement {
    const video = document.createElement("video")
    video.src = toFileUrl(path)
    video.crossOrigin = "anonymous"
    video.preload = "auto"
    video.loop = loop
    video.muted = muted
    video.autoplay = true
    video.playsInline = true
    // Position off-screen — don't constrain dimensions so browser decodes at full resolution
    video.style.position = "fixed"
    video.style.top = "-9999px"
    video.style.left = "-9999px"
    video.style.pointerEvents = "none"
    document.body.appendChild(video)
    video.play().catch((e) => console.warn("BackgroundLayer: video play failed:", e))
    return video
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
    return new Promise((resolve) => {
        const checkDimensions = () => video.videoWidth > 0 && video.videoHeight > 0

        if (video.readyState >= 2 && checkDimensions()) {
            resolve()
            return
        }

        const onReady = () => {
            // canplay fired but dimensions may not be available yet — poll briefly
            if (checkDimensions()) {
                cleanup()
                resolve()
                return
            }
            // Poll for dimensions (some browsers need a frame or two)
            let polls = 0
            const poll = setInterval(() => {
                polls++
                if (checkDimensions() || polls > 20) {
                    clearInterval(poll)
                    cleanup()
                    resolve()
                }
            }, 50)
        }
        const onError = () => {
            cleanup()
            console.warn("BackgroundLayer: video load error:", video.src)
            resolve() // resolve anyway so we don't hang
        }
        const cleanup = () => {
            video.removeEventListener("canplay", onReady)
            video.removeEventListener("loadeddata", onReady)
            video.removeEventListener("error", onError)
        }
        video.addEventListener("canplay", onReady)
        video.addEventListener("loadeddata", onReady)
        video.addEventListener("error", onError)
        // Timeout fallback
        setTimeout(() => {
            cleanup()
            resolve()
        }, 5000)
    })
}

function cleanupVideoElement(video: HTMLVideoElement | null): void {
    if (!video) return
    video.pause()
    video.src = ""
    video.load()
    video.remove()
}

function attachVideoTimeListeners(video: HTMLVideoElement, handler: VideoTimeCallback): void {
    const report = () => handler({ currentTime: video.currentTime || 0, duration: Number.isFinite(video.duration) ? video.duration : 0, paused: video.paused })
    video.addEventListener("timeupdate", report)
    video.addEventListener("loadedmetadata", report)
    video.addEventListener("play", report)
    video.addEventListener("pause", report)
    video.addEventListener("seeked", report)
}

export function destroyBackgroundLayer(state: BackgroundLayerState, transitionId: string): void {
    clearBackground(state, transitionId)
    state.container.destroy({ children: true })
}
