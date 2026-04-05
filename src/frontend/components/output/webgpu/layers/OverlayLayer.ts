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

    for (const [id, entry] of state.entries) {
        if (!activeSet.has(id) && !entry.clearing) {
            entry.clearing = true
            startTransition(
                `overlay-out-${id}`,
                transition.type || "fade",
                transition.duration ?? 500,
                transition.easing || "sine",
                entry.sprite,
                entry.sprite,
                undefined,
                () => {
                    state.container.removeChild(entry.sprite)
                    entry.sprite.destroy()
                    state.entries.delete(id)
                }
            )
            entry.sprite.alpha = 1
        }
    }

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
