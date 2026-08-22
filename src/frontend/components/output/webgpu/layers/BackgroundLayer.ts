import { Container, Texture } from "pixi.js"
import type { Sprite } from "pixi.js"
import type { Transition } from "../../../../../types/Show"
import type { GPUBackgroundData } from "../../gpu/GPUBackgroundStyle"
import type { DualSpriteState } from "../../../../../types/WebGPU"
import { createLatestRequest } from "../../../../utils/latestRequest"
import type { OutputRenderAuthority } from "../../../../outputState/clientRuntime"
import { loadImageTexture, releaseImageTexture, createVideoTexture, createMediaSprite, applyFit, applyMediaStyle, removeSprite } from "./MediaLayer"
import { startTransition, cancelTransition } from "../transitionManager"
import { applyVideoControlData, getVideoControlSnapshot, type VideoControlData } from "../videoControlState"
import { isVideoSource } from "./mediaSource"

export type VideoTimeCallback = (info: ReturnType<typeof getVideoControlSnapshot> & { identity?: string; force?: boolean }) => void
const videoListenerCleanup = new WeakMap<HTMLVideoElement, () => void>()

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
    currentAnimation: string
    latestUpdate: ReturnType<typeof createLatestRequest>
    getAuthority: () => OutputRenderAuthority
}

export function createBackgroundLayer(parentContainer: Container, width: number, height: number, videoTimeHandler: VideoTimeCallback | null = null, getAuthority: () => OutputRenderAuthority = () => ({ sessionId: "", revision: 0 })): BackgroundLayerState {
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
        videoTimeHandler,
        currentAnimation: "",
        latestUpdate: createLatestRequest(),
        getAuthority
    }
}

export function setAnimationTransform(state: BackgroundLayerState, animationStyle: string): void {
    state.currentAnimation = animationStyle
    // Defer the actual tween setup to backgroundAnimation.ts to keep layer code free of parser logic.
    // We pass the current active sprite so the animation module can start a tween from its pose.
    const currentIsA = state.dualState.activeSlot === "a"
    const sprite = currentIsA ? state.spriteA : state.spriteB
    if (!sprite) return
    // Lazy import to avoid circular deps
    import("../backgroundAnimation").then(({ applyAnimation }) => {
        applyAnimation(sprite, state.width, state.height, animationStyle)
    })
}

export async function updateBackground(state: BackgroundLayerState, data: GPUBackgroundData | null, transition: Transition, transitionId: string): Promise<void> {
    const updateRequest = state.latestUpdate.start()
    const authority = state.getAuthority()

    if (!data || (!data.path && !data.id)) {
        clearBackground(state, transitionId)
        return
    }

    const newPath = data.path || data.id || ""
    const fit = data.fit || "contain"

    // Determine which slot is currently "active" (the visible one)
    let currentIsA = state.dualState.activeSlot === "a"
    const currentPath = currentIsA ? state.dualState.slotAPath : state.dualState.slotBPath
    let currentSprite = currentIsA ? state.spriteA : state.spriteB

    // Same-path short-circuit: hoisted ABOVE resource allocation + cancelTransition.
    // Reactive callers (WebGPUOutput.svelte) re-invoke updateBackground whenever ANY transition
    // field changes (including text/overlay). Without this early check, each text-transition edit
    // leaks a hidden video element and cancels in-progress media transitions.
    if (newPath === currentPath && currentPath !== "") {
        if (currentSprite) {
            applyFit(currentSprite, state.width, state.height, fit, currentIsA ? state.sourceWidthA : state.sourceWidthB, currentIsA ? state.sourceHeightA : state.sourceHeightB)
            applyMediaStyle(currentSprite, data)
            if (currentIsA) state.fitA = fit
            else state.fitB = fit
        }
        await updateActiveVideoData(state, { loop: data.loop, muted: data.muted })
        return
    }

    // Use file-extension detection as the authoritative check for video vs image. Style backgrounds
    // don't carry a data.type field (they're built from MediaStyle which only has
    // filter/flip/crop/etc), so type-based detection wrongly routes mp4/webm to the image loader.
    // The extension check works for both slide backgrounds (which have data.type set) and style
    // backgrounds (which don't).
    const isVideo = isVideoSource(newPath, data.type)

    let newTexture: Texture
    let videoElement: HTMLVideoElement | null = null
    let srcW = 0
    let srcH = 0

    if (isVideo) {
        videoElement = createHiddenVideoElement(newPath, data.loop ?? false, data.muted ?? true)
        attachVideoTimeListeners(videoElement, state.videoTimeHandler)
        await waitForVideoReady(videoElement)
        if (data.startAt && Number.isFinite(data.startAt)) videoElement.currentTime = data.startAt
        newTexture = createVideoTexture(videoElement)
        srcW = videoElement.videoWidth
        srcH = videoElement.videoHeight
    } else {
        const loaded = await loadImageTexture(newPath)
        newTexture = loaded.texture
        srcW = loaded.width
        srcH = loaded.height
    }

    // A clear or newer background may arrive while the media is loading.
    const currentAuthority = state.getAuthority()
    if (!updateRequest.isCurrent() || currentAuthority.sessionId !== authority.sessionId || currentAuthority.revision !== authority.revision) {
        if (videoElement && newTexture !== Texture.EMPTY && !newTexture.destroyed) newTexture.destroy(true)
        cleanupVideoElement(videoElement)
        if (!videoElement) releaseImageTexture(newPath)
        return
    }

    // After async gap: cancel any in-progress transition and clean up stale state
    cancelTransition(transitionId)
    // Cancellation completes the interrupted transition and can therefore change activeSlot.
    // Re-read ownership after the async load and cancellation before choosing which slot to reuse.
    currentIsA = state.dualState.activeSlot === "a"
    currentSprite = currentIsA ? state.spriteA : state.spriteB

    // Clean up the non-active slot (may have an orphaned sprite from a cancelled transition)
    if (currentIsA) {
        releaseImageTexture(state.dualState.slotBPath)
        removeSprite(state.spriteB, state.container, !!state.videoElementB)
        cleanupVideoElement(state.videoElementB)
        state.spriteB = null
        state.videoElementB = null
        state.fitB = "cover"
        state.sourceWidthB = 0
        state.sourceHeightB = 0
        state.dualState.slotBPath = ""
    } else {
        releaseImageTexture(state.dualState.slotAPath)
        removeSprite(state.spriteA, state.container, !!state.videoElementA)
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
    }

    // Create new sprite in the non-active slot
    if (currentIsA) {
        state.spriteB = createMediaSprite(newTexture, state.container, state.width, state.height, fit, srcW, srcH)
        applyMediaStyle(state.spriteB, data)
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
                releaseImageTexture(state.dualState.slotAPath)
                removeSprite(state.spriteA, state.container, !!state.videoElementA)
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
        applyMediaStyle(state.spriteA, data)
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
                releaseImageTexture(state.dualState.slotBPath)
                removeSprite(state.spriteB, state.container, !!state.videoElementB)
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
    state.latestUpdate.invalidate()
    cancelTransition(transitionId)
    releaseImageTexture(state.dualState.slotAPath)
    releaseImageTexture(state.dualState.slotBPath)
    removeSprite(state.spriteA, state.container, !!state.videoElementA)
    removeSprite(state.spriteB, state.container, !!state.videoElementB)
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

export async function updateActiveVideoData(state: BackgroundLayerState, data: VideoControlData): Promise<void> {
    const video = getActiveVideoElement(state)
    if (!video) return

    await applyVideoControlData(video, data)
    reportVideoState(state, video)
}

// playback command round-trip (#17): apply an operator/API command to the active hidden
// video and republish the canonical snapshot immediately after it is applied
export async function applyPlaybackCommand(state: BackgroundLayerState, command: { type: "pause" | "resume" | "seek" | "mute" | "unmute"; time?: number }): Promise<void> {
    const video = getActiveVideoElement(state)
    if (!video) return

    if (command.type === "pause" && !video.paused) video.pause()
    else if (command.type === "resume" && video.paused) await video.play().catch((e) => console.warn("BackgroundLayer: resume failed:", e))
    else if (command.type === "seek" && Number.isFinite(command.time)) video.currentTime = command.time!
    else if (command.type === "mute") video.muted = true
    else if (command.type === "unmute") video.muted = false
    else return

    // command results must always reach the canonical snapshot (#17) — bypass the time throttle
    reportVideoState(state, video, true)
}

function getActiveVideoElement(state: BackgroundLayerState): HTMLVideoElement | null {
    const activeVideo = state.dualState.activeSlot === "a" ? state.videoElementA : state.videoElementB
    return activeVideo || state.videoElementA || state.videoElementB
}

function reportVideoState(state: BackgroundLayerState, video: HTMLVideoElement, force = false): void {
    if (!state.videoTimeHandler) return
    const identity = state.dualState.activeSlot === "b" ? state.dualState.slotBPath : state.dualState.slotAPath
    state.videoTimeHandler({ ...getVideoControlSnapshot(video), identity: identity || undefined, force })
}

function toFileUrl(path: string): string {
    if (!path || path.startsWith("http") || path.startsWith("file://") || path.startsWith("blob:") || path.startsWith("data:")) return path
    // Local filesystem path — Electron needs file:// protocol
    if (path.startsWith("/")) return `file://${path}`
    return path
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
        let settled = false
        let poll: ReturnType<typeof setInterval> | null = null
        let timeout: ReturnType<typeof setTimeout> | null = null

        const finish = () => {
            if (settled) return
            settled = true
            if (poll) clearInterval(poll)
            if (timeout) clearTimeout(timeout)
            video.removeEventListener("canplay", onReady)
            video.removeEventListener("loadeddata", onReady)
            video.removeEventListener("error", onError)
            resolve()
        }

        if (video.readyState >= 2 && checkDimensions()) {
            finish()
            return
        }

        function onReady() {
            // canplay fired but dimensions may not be available yet — poll briefly
            if (checkDimensions()) {
                finish()
                return
            }
            // Poll for dimensions (some browsers need a frame or two)
            if (poll) return
            let polls = 0
            poll = setInterval(() => {
                polls++
                if (checkDimensions() || polls > 20) {
                    finish()
                }
            }, 50)
        }
        function onError() {
            console.warn("BackgroundLayer: video load error:", video.src)
            finish() // resolve anyway so we don't hang
        }
        video.addEventListener("canplay", onReady)
        video.addEventListener("loadeddata", onReady)
        video.addEventListener("error", onError)
        // Timeout fallback
        timeout = setTimeout(finish, 5000)
    })
}

function cleanupVideoElement(video: HTMLVideoElement | null): void {
    if (!video) return
    videoListenerCleanup.get(video)?.()
    videoListenerCleanup.delete(video)
    video.pause()
    video.src = ""
    video.load()
    video.remove()
}

function attachVideoTimeListeners(video: HTMLVideoElement, handler: VideoTimeCallback | null): void {
    const report = () => handler?.(getVideoControlSnapshot(video))
    video.addEventListener("timeupdate", report)
    video.addEventListener("loadedmetadata", report)
    video.addEventListener("play", report)
    video.addEventListener("pause", report)
    video.addEventListener("seeked", report)
    // mute/unmute can arrive through reactive state updates (not playback commands) — republish so
    // the canonical per-output snapshot never goes stale (#17)
    video.addEventListener("volumechange", report)
    videoListenerCleanup.set(video, () => {
        video.removeEventListener("timeupdate", report)
        video.removeEventListener("loadedmetadata", report)
        video.removeEventListener("play", report)
        video.removeEventListener("pause", report)
        video.removeEventListener("seeked", report)
        video.removeEventListener("volumechange", report)
    })
}

export function destroyBackgroundLayer(state: BackgroundLayerState, transitionId: string): void {
    clearBackground(state, transitionId)
    state.container.destroy({ children: true })
}
