import type { OutBackground, Transition } from "../../../../types/Show"
import type { VideoTimeCallback } from "./layers/BackgroundLayer"

// All layer modules loaded dynamically to avoid static pixi.js imports
let bgMod: any = null
let overlayMod: any = null
let slideMod: any = null
let transitionMod: any = null

async function getBgMod() {
    if (!bgMod) bgMod = await import("./layers/BackgroundLayer")
    return bgMod
}
async function getOverlayMod() {
    if (!overlayMod) overlayMod = await import("./layers/OverlayLayer")
    return overlayMod
}
async function getSlideMod() {
    if (!slideMod) slideMod = await import("./layers/SlideLayer")
    return slideMod
}
async function getTransitionMod() {
    if (!transitionMod) transitionMod = await import("./transitionManager")
    return transitionMod
}

export interface LayerManagerState {
    app: any
    containers: any
    styleBackground: any
    slideBackground: any
    slideLayer: any
    overlayLayer: any
    width: number
    height: number
}

export async function createLayerManager(app: any, containers: any, width: number, height: number, slideVideoTimeHandler: VideoTimeCallback | null = null): Promise<LayerManagerState> {
    const bg = await getBgMod()
    const ov = await getOverlayMod()
    const sl = await getSlideMod()

    const styleBackground = bg.createBackgroundLayer(containers.background, width, height)
    // only the slide background reports time — style background is a decorative loop and not the user-controlled video
    const slideBackground = bg.createBackgroundLayer(containers.background, width, height, slideVideoTimeHandler)
    const slideLayer = await sl.createSlideLayer(containers.slide, width, height)
    const overlayLayer = ov.createOverlayLayer(containers.overlays, width, height)

    return {
        app,
        containers,
        styleBackground,
        slideBackground,
        slideLayer,
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
    const bg = await getBgMod()
    await bg.updateBackground(state.styleBackground, data, transition, "style-bg")
}

export async function updateSlideBackground(
    state: LayerManagerState,
    data: OutBackground | null,
    transition: Transition
): Promise<void> {
    const bg = await getBgMod()
    await bg.updateBackground(state.slideBackground, data, transition, "slide-bg")
}

export async function updateSlideText(
    state: LayerManagerState,
    slideElement: HTMLElement | null,
    slideKey: string,
    transition: Transition,
    isClearing: boolean
): Promise<void> {
    const sl = await getSlideMod()
    sl.updateSlideContent(state.slideLayer, slideElement, slideKey, transition, isClearing)
}

export async function setStyleAnimation(state: LayerManagerState, animationStyle: string): Promise<void> {
    const bg = await getBgMod()
    bg.setAnimationTransform(state.styleBackground, animationStyle)
}

export async function setSlideAnimation(state: LayerManagerState, animationStyle: string): Promise<void> {
    const bg = await getBgMod()
    bg.setAnimationTransform(state.slideBackground, animationStyle)
}

export async function resizeAllLayers(state: LayerManagerState, width: number, height: number): Promise<void> {
    state.width = width
    state.height = height
    const bg = await getBgMod()
    const ov = await getOverlayMod()
    const sl = await getSlideMod()
    bg.resizeBackground(state.styleBackground, width, height)
    bg.resizeBackground(state.slideBackground, width, height)
    sl.resizeSlideLayer(state.slideLayer, width, height)
    ov.resizeOverlays(state.overlayLayer, width, height)
}

export async function destroyLayerManager(state: LayerManagerState): Promise<void> {
    const tm = await getTransitionMod()
    const bg = await getBgMod()
    const ov = await getOverlayMod()
    const sl = await getSlideMod()
    tm.cancelAllTransitions()
    bg.destroyBackgroundLayer(state.styleBackground, "style-bg")
    bg.destroyBackgroundLayer(state.slideBackground, "slide-bg")
    sl.destroySlideLayer(state.slideLayer)
    ov.destroyOverlayLayer(state.overlayLayer)
}
