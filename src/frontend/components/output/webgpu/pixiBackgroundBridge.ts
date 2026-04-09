import { getContext, setContext } from "svelte"
import type { OutBackground, Transition } from "../../../../types/Show"

export const PIXI_BG_BRIDGE_KEY = Symbol("pixiBackgroundBridge")

/** Media types the Pixi layer can render. Everything else must fall back to DOM. */
export const PIXI_SUPPORTED_TYPES = new Set(["media", "video", "image"])

export function isPixiSupported(type: string | undefined | null): boolean {
    // undefined/empty defaults to "media" per BackgroundMedia.svelte convention
    if (!type) return true
    return PIXI_SUPPORTED_TYPES.has(type)
}

export interface PixiBackgroundBridge {
    /**
     * Update (or clear) a background slot. `slot === "style"` drives the style-background Pixi
     * sprite; `slot === "slide"` drives the slide-background sprite. Returns `true` if the bridge
     * accepted the update (caller should skip DOM render); `false` if the bridge refused (caller
     * must render DOM — e.g. for live-stream media types not supported by Pixi).
     */
    update(slot: "style" | "slide", data: OutBackground | null, transition: Transition): boolean
    /** Clear a background slot immediately (used when caller unmounts). */
    clear(slot: "style" | "slide"): void
    /** Apply an animation transform string (as emitted by output/animation.ts) to the given slot. */
    setAnimation(slot: "style" | "slide", animationStyle: string): void
}

export function providePixiBackgroundBridge(bridge: PixiBackgroundBridge): void {
    setContext(PIXI_BG_BRIDGE_KEY, bridge)
}

export function getPixiBackgroundBridge(): PixiBackgroundBridge | undefined {
    return getContext<PixiBackgroundBridge | undefined>(PIXI_BG_BRIDGE_KEY)
}
