import type { Application } from "pixi.js"
import type { OutBackground, Transition } from "../../../../types/Show"
import type { StageContainers } from "./PixiRenderer"
import { createBackgroundLayer, updateBackground, resizeBackground, destroyBackgroundLayer, type BackgroundLayerState } from "./layers/BackgroundLayer"
import { createOverlayLayer, resizeOverlays, destroyOverlayLayer, type OverlayLayerState } from "./layers/OverlayLayer"
import { createSlideLayer, updateSlideContent, resizeSlideLayer, destroySlideLayer, type SlideLayerState } from "./layers/SlideLayer"
import { cancelAllTransitions } from "./transitionManager"

export interface LayerManagerState {
    app: Application
    containers: StageContainers
    styleBackground: BackgroundLayerState
    slideBackground: BackgroundLayerState
    slideLayer: SlideLayerState
    overlayLayer: OverlayLayerState
    width: number
    height: number
}

export function createLayerManager(app: Application, containers: StageContainers, width: number, height: number): LayerManagerState {
    const styleBackground = createBackgroundLayer(containers.background, width, height)
    const slideBackground = createBackgroundLayer(containers.background, width, height)
    const slideLayer = createSlideLayer(containers.slide, width, height)
    const overlayLayer = createOverlayLayer(containers.overlays, width, height)

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
    await updateBackground(state.styleBackground, data, transition, "style-bg")
}

export async function updateSlideBackground(
    state: LayerManagerState,
    data: OutBackground | null,
    transition: Transition
): Promise<void> {
    await updateBackground(state.slideBackground, data, transition, "slide-bg")
}

export function updateSlideText(
    state: LayerManagerState,
    slideElement: HTMLElement | null,
    slideKey: string,
    transition: Transition,
    isClearing: boolean
): void {
    updateSlideContent(state.slideLayer, slideElement, slideKey, transition, isClearing)
}

export function resizeAllLayers(state: LayerManagerState, width: number, height: number): void {
    state.width = width
    state.height = height
    resizeBackground(state.styleBackground, width, height)
    resizeBackground(state.slideBackground, width, height)
    resizeSlideLayer(state.slideLayer, width, height)
    resizeOverlays(state.overlayLayer, width, height)
}

export function destroyLayerManager(state: LayerManagerState): void {
    cancelAllTransitions()
    destroyBackgroundLayer(state.styleBackground, "style-bg")
    destroyBackgroundLayer(state.slideBackground, "slide-bg")
    destroySlideLayer(state.slideLayer)
    destroyOverlayLayer(state.overlayLayer)
}
