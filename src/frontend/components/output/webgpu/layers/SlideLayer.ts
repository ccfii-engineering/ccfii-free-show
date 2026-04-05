import { Container, Sprite, Texture } from "pixi.js"
import type { Transition } from "../../../../../types/Show"
import { startTransition, cancelTransition } from "../transitionManager"
import { queueRasterize } from "./TextRasterizer"

export interface SlideLayerState {
    container: Container
    currentSprite: Sprite | null
    previousSprite: Sprite | null
    width: number
    height: number
    currentSlideKey: string
}

export function createSlideLayer(parentContainer: Container, width: number, height: number): SlideLayerState {
    const container = new Container()
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
    // Same content — skip
    if (slideKey === state.currentSlideKey && !isClearing) return
    state.currentSlideKey = slideKey

    if (!slideElement || isClearing) {
        clearSlide(state)
        return
    }

    queueRasterize(slideElement, state.width, state.height, (texture) => {
        if (texture === Texture.EMPTY) return

        // Move current to previous for crossfade
        if (state.currentSprite) {
            if (state.previousSprite) {
                state.container.removeChild(state.previousSprite)
                state.previousSprite.destroy()
            }
            state.previousSprite = state.currentSprite
        }

        // Create new sprite
        const sprite = new Sprite(texture)
        sprite.width = state.width
        sprite.height = state.height
        state.container.addChild(sprite)
        state.currentSprite = sprite

        // Transition
        startTransition(
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

function clearSlide(state: SlideLayerState): void {
    cancelTransition("slide-text")
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

export function destroySlideLayer(state: SlideLayerState): void {
    clearSlide(state)
    state.container.destroy({ children: true })
}
