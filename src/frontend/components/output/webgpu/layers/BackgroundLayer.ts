import { Container, Sprite, Texture } from "pixi.js"
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
        clearBackground(state, transitionId)
        return
    }

    const newPath = data.path || data.id || ""
    const currentPath = state.dualState.activeSlot === "a" ? state.dualState.slotAPath : state.dualState.slotBPath

    if (newPath === currentPath && currentPath !== "") return

    const loadIntoA = state.dualState.activeSlot !== "a"
    const isVideo = data.type === "video" || data.type === "media"

    let newTexture: Texture
    let videoElement: HTMLVideoElement | null = null

    if (isVideo && isVideoPath(newPath)) {
        videoElement = createHiddenVideoElement(newPath, data.loop ?? false, data.muted ?? true)
        // Wait for video to be ready before creating texture
        await waitForVideoReady(videoElement)
        newTexture = createVideoTexture(videoElement)
        console.log("BackgroundLayer: video texture created for", newPath)
    } else {
        newTexture = await loadImageTexture(toFileUrl(newPath))
        console.log("BackgroundLayer: image texture created for", newPath)
    }

    const fit = data.fit || "cover"

    if (loadIntoA) {
        removeSprite(state.spriteA, state.container)
        cleanupVideoElement(state.videoElementA)

        state.spriteA = createMediaSprite(newTexture, state.container, state.width, state.height, fit)
        state.videoElementA = videoElement
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
                state.dualState.slotBPath = ""
                state.dualState.activeSlot = "a"
            }
        )
    } else {
        removeSprite(state.spriteB, state.container)
        cleanupVideoElement(state.videoElementB)

        state.spriteB = createMediaSprite(newTexture, state.container, state.width, state.height, fit)
        state.videoElementB = videoElement
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
        if (video.readyState >= 2) {
            resolve()
            return
        }
        const onReady = () => {
            video.removeEventListener("canplay", onReady)
            video.removeEventListener("error", onError)
            resolve()
        }
        const onError = () => {
            video.removeEventListener("canplay", onReady)
            video.removeEventListener("error", onError)
            console.warn("BackgroundLayer: video load error:", video.src)
            resolve() // resolve anyway so we don't hang
        }
        video.addEventListener("canplay", onReady)
        video.addEventListener("error", onError)
        // Timeout fallback
        setTimeout(resolve, 5000)
    })
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
