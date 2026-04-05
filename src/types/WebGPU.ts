import type { TransitionType } from "./Show"

export interface PixiOutputConfig {
    width: number
    height: number
    backgroundColor: string
    transparent: boolean
    preference: "webgpu" | "webgl"
}

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

export interface CaptureFrameRequest {
    id: string
    width: number
    height: number
    format: "rgba" | "bgra"
}

export interface CaptureFrameResponse {
    id: string
    time: number
    buffer: Buffer | Uint8Array
    size: { width: number; height: number }
}
