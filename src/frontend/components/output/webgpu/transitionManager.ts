import { BlurFilter, Sprite, type Container } from "pixi.js"
import { backInOut, bounceInOut, circInOut, cubicInOut, elasticInOut, linear, sineInOut } from "svelte/easing"
import type { TransitionType } from "../../../../types/Show"
import type { TransitionState } from "../../../../types/WebGPU"

const easingFunctions: { [key: string]: (t: number) => number } = {
    linear,
    back: backInOut,
    sine: sineInOut,
    circ: circInOut,
    cubic: cubicInOut,
    elastic: elasticInOut,
    bounce: bounceInOut
}

export function getEasing(name: string): (t: number) => number {
    return easingFunctions[name] || sineInOut
}

// baseline pose captured at transition start — so we can animate *relative* to applyFit's computed layout
// rather than fighting with it (scale would drift, spin pivot would slide, slide position would leak).
interface Baseline {
    x: number
    y: number
    width: number
    height: number
}

function captureBaseline(node: Sprite | Container | null): Baseline | null {
    if (!node) return null
    return { x: node.x, y: node.y, width: node.width, height: node.height }
}

function restoreBaseline(node: Sprite | Container | null, baseline: Baseline | null): void {
    if (!node || !baseline) return
    node.x = baseline.x
    node.y = baseline.y
    if (node instanceof Sprite) {
        node.width = baseline.width
        node.height = baseline.height
    }
    node.rotation = 0
    node.alpha = 1
    node.filters = []
}

export interface ActiveTransition {
    state: TransitionState
    oldSprite: Sprite | Container | null
    newSprite: Sprite | Container
    oldBaseline: Baseline | null
    newBaseline: Baseline
    layerWidth: number
    layerHeight: number
    blurFilter?: BlurFilter
    onComplete: () => void
    rafId: number
}

const activeTransitions = new Map<string, ActiveTransition>()

export function startTransition(
    id: string,
    type: TransitionType,
    duration: number,
    easing: string,
    oldSprite: Sprite | Container | null,
    newSprite: Sprite | Container,
    direction?: string,
    onComplete?: () => void,
    layerWidth: number = 1920,
    layerHeight: number = 1080
): void {
    cancelTransition(id)

    if (type === "none" || duration <= 0) {
        if (oldSprite) oldSprite.visible = false
        newSprite.visible = true
        newSprite.alpha = 1
        newSprite.rotation = 0
        onComplete?.()
        return
    }

    const newBaseline = captureBaseline(newSprite)!
    const oldBaseline = captureBaseline(oldSprite)

    const state: TransitionState = {
        active: true,
        type,
        duration,
        easing,
        progress: 0,
        startTime: performance.now(),
        direction: direction as TransitionState["direction"]
    }

    newSprite.visible = true
    applyTransitionPose(type, newSprite, newBaseline, 0, direction, "in", layerWidth, layerHeight)

    let blurFilter: BlurFilter | undefined
    if (type === "blur") {
        blurFilter = new BlurFilter({ strength: 10 })
        newSprite.filters = [blurFilter]
    }

    const transition: ActiveTransition = {
        state,
        oldSprite,
        newSprite,
        oldBaseline,
        newBaseline,
        layerWidth,
        layerHeight,
        blurFilter,
        onComplete: onComplete || (() => {}),
        rafId: 0
    }

    activeTransitions.set(id, transition)
    transition.rafId = requestAnimationFrame((time) => tick(id, time))
}

function tick(id: string, currentTime: number): void {
    const transition = activeTransitions.get(id)
    if (!transition || !transition.state.active) return

    const elapsed = currentTime - transition.state.startTime
    const rawProgress = Math.min(1, elapsed / transition.state.duration)
    const easingFn = getEasing(transition.state.easing)
    const t = easingFn(rawProgress)

    transition.state.progress = rawProgress

    applyTransitionPose(transition.state.type, transition.newSprite, transition.newBaseline, t, transition.state.direction, "in", transition.layerWidth, transition.layerHeight)

    if (transition.oldSprite && transition.oldBaseline) {
        applyTransitionPose(transition.state.type, transition.oldSprite, transition.oldBaseline, 1 - t, transition.state.direction, "out", transition.layerWidth, transition.layerHeight)
    }

    if (transition.blurFilter) {
        transition.blurFilter.strength = (1 - t) * 10
    }

    if (rawProgress >= 1) {
        completeTransition(id)
        return
    }

    transition.rafId = requestAnimationFrame((time) => tick(id, time))
}

// Applies a pose for progress `t` (0 = fully "entering", 1 = fully settled) relative to a captured baseline.
// This keeps transitions independent from applyFit's top-left positioning.
function applyTransitionPose(type: TransitionType, node: Sprite | Container, baseline: Baseline, t: number, direction: string | undefined, mode: "in" | "out", layerWidth: number, layerHeight: number): void {
    // reset to baseline first — so each tick is independent
    node.x = baseline.x
    node.y = baseline.y
    if (node instanceof Sprite) {
        node.width = baseline.width
        node.height = baseline.height
    }
    node.rotation = 0
    node.alpha = 1

    switch (type) {
        case "fade":
        case "crossfade":
            node.alpha = t
            break

        case "blur":
            node.alpha = t
            break

        case "scale": {
            // scale from baseline center — adjust position so the center stays fixed
            node.alpha = t
            if (node instanceof Sprite) {
                node.width = baseline.width * t
                node.height = baseline.height * t
            }
            node.x = baseline.x + (baseline.width * (1 - t)) / 2
            node.y = baseline.y + (baseline.height * (1 - t)) / 2
            break
        }

        case "spin": {
            // rotate around baseline center
            node.alpha = t
            const cx = baseline.x + baseline.width / 2
            const cy = baseline.y + baseline.height / 2
            // Use pivot-as-center via compensating position: shift so rotation pivot sits at center
            // (Pixi rotates around the node's pivot, which defaults to (0,0) in node-local space).
            // Cheapest correct technique: temporarily move node so baseline-center lands at origin,
            // rotate, then translate back.
            node.pivot.set(baseline.width / 2, baseline.height / 2)
            node.x = cx
            node.y = cy
            node.rotation = t * Math.PI * 2
            break
        }

        case "slide": {
            const offset = 1 - t
            const isOut = mode === "out"
            const dir = direction || "left_right"
            // "in": slide from offscreen toward baseline; "out": slide from baseline toward offscreen
            if (dir === "left_right") node.x = baseline.x + (isOut ? 1 : -1) * offset * layerWidth
            else if (dir === "right_left") node.x = baseline.x + (isOut ? -1 : 1) * offset * layerWidth
            else if (dir === "bottom_top") node.y = baseline.y + (isOut ? -1 : 1) * offset * layerHeight
            else if (dir === "top_bottom") node.y = baseline.y + (isOut ? 1 : -1) * offset * layerHeight
            break
        }

        case "fly": {
            // Svelte's default fly: x=100, opacity=0 → identity. Combine horizontal travel with fade.
            node.alpha = t
            const dir = direction || "left_right"
            const offset = (1 - t) * 100
            const isOut = mode === "out"
            if (dir === "left_right" || dir === "right_left") node.x = baseline.x + (dir === "right_left" ? -offset : offset) * (isOut ? -1 : 1)
            else if (dir === "bottom_top" || dir === "top_bottom") node.y = baseline.y + (dir === "top_bottom" ? -offset : offset) * (isOut ? -1 : 1)
            else node.x = baseline.x + offset
            break
        }

        default:
            node.alpha = t
    }
}

function completeTransition(id: string): void {
    const transition = activeTransitions.get(id)
    if (!transition) return

    if (transition.oldSprite) {
        restoreBaseline(transition.oldSprite, transition.oldBaseline)
        transition.oldSprite.visible = false
        if (transition.oldSprite.pivot) transition.oldSprite.pivot.set(0, 0)
    }

    restoreBaseline(transition.newSprite, transition.newBaseline)
    if (transition.newSprite.pivot) transition.newSprite.pivot.set(0, 0)

    transition.state.active = false
    transition.onComplete()
    activeTransitions.delete(id)
}

export function cancelTransition(id: string): void {
    const transition = activeTransitions.get(id)
    if (!transition) return

    cancelAnimationFrame(transition.rafId)
    transition.state.active = false
    activeTransitions.delete(id)
}

export function cancelAllTransitions(): void {
    for (const [id] of activeTransitions) {
        cancelTransition(id)
    }
}
