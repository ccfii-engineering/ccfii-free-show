import type { TransitionType } from "./Show"

export interface RenderLayer {
    id: string
    type: "background" | "underlay" | "slide" | "effect" | "overlay" | "draw"
    visible: boolean
    zIndex: number
}

export interface TransitionState {
    active: boolean
    type: TransitionType
    duration: number
    easing: string
    progress: number
    startTime: number
    direction?: "left_right" | "right_left" | "bottom_top" | "top_bottom"
}

export interface DualSpriteState {
    activeSlot: "a" | "b"
    slotAPath: string
    slotBPath: string
    transition: TransitionState | null
}
