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
