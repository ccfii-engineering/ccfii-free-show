import type { Transition } from "../../../../../types/Show"
import { queueRasterize } from "./TextRasterizer"

let pixiModule: any = null
async function getPixi() {
    if (!pixiModule) pixiModule = await import("pixi.js")
    return pixiModule
}

// Use dynamic imports for transition manager too
let transitionMod: any = null
async function getTransitionMod() {
    if (!transitionMod) transitionMod = await import("../transitionManager")
    return transitionMod
}

export interface SlideLayerState {
    container: any // PixiJS Container
    currentSprite: any | null
    previousSprite: any | null
    width: number
    height: number
    currentSlideKey: string
}

export async function createSlideLayer(parentContainer: any, width: number, height: number): Promise<SlideLayerState> {
    const PIXI = await getPixi()
    const container = new PIXI.Container()
    container.label = "slide-layer"
    parentContainer.addChild(container)

    return {
        container,
        currentSprite: null,
        previousSprite: null,
        width,
        height,
        currentSlideKey: ""
    }
}

export function updateSlideContent(
    state: SlideLayerState,
    slideElement: HTMLElement | null,
    slideKey: string,
    transition: Transition,
    isClearing: boolean
): void {
    if (slideKey === state.currentSlideKey && !isClearing) return
    state.currentSlideKey = slideKey

    if (!slideElement || isClearing) {
        clearSlide(state)
        return
    }

    console.log("SlideLayer: rasterizing, children:", slideElement.children?.length, "size:", state.width, "x", state.height)
    queueRasterize(slideElement, state.width, state.height, async (texture: any) => {
        const PIXI = await getPixi()
        const tm = await getTransitionMod()

        console.log("SlideLayer: texture result, valid:", texture !== PIXI.Texture.EMPTY)
        if (texture === PIXI.Texture.EMPTY) return

        if (state.currentSprite) {
            if (state.previousSprite) {
                state.container.removeChild(state.previousSprite)
                state.previousSprite.destroy()
            }
            state.previousSprite = state.currentSprite
        }

        const sprite = new PIXI.Sprite(texture)
        sprite.width = state.width
        sprite.height = state.height
        state.container.addChild(sprite)
        state.currentSprite = sprite

        tm.startTransition(
            "slide-text",
            transition.type || "fade",
            transition.duration ?? 500,
            transition.easing || "sine",
            state.previousSprite,
            sprite,
            transition.custom?.direction,
            () => {
                if (state.previousSprite) {
                    state.container.removeChild(state.previousSprite)
                    state.previousSprite.destroy()
                    state.previousSprite = null
                }
            }
        )
    })
}

export function resizeSlideLayer(state: SlideLayerState, width: number, height: number): void {
    state.width = width
    state.height = height
    if (state.currentSprite) {
        state.currentSprite.width = width
        state.currentSprite.height = height
    }
    if (state.previousSprite) {
        state.previousSprite.width = width
        state.previousSprite.height = height
    }
}

async function clearSlide(state: SlideLayerState): Promise<void> {
    const tm = await getTransitionMod()
    tm.cancelTransition("slide-text")
    if (state.currentSprite) {
        state.container.removeChild(state.currentSprite)
        state.currentSprite.destroy()
        state.currentSprite = null
    }
    if (state.previousSprite) {
        state.container.removeChild(state.previousSprite)
        state.previousSprite.destroy()
        state.previousSprite = null
    }
    state.currentSlideKey = ""
}

export async function destroySlideLayer(state: SlideLayerState): Promise<void> {
    await clearSlide(state)
    state.container.destroy({ children: true })
}
