import { BlurFilter, type Container, type Sprite } from "pixi.js"
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

export interface ActiveTransition {
    state: TransitionState
    oldSprite: Sprite | Container | null
    newSprite: Sprite | Container
    blurFilter?: BlurFilter
    onComplete: () => void
    rafId: number
}

const activeTransitions = new Map<string, ActiveTransition>()

export function startTransition(id: string, type: TransitionType, duration: number, easing: string, oldSprite: Sprite | Container | null, newSprite: Sprite | Container, direction?: string, onComplete?: () => void): void {
    cancelTransition(id)

    if (type === "none" || duration <= 0) {
        if (oldSprite) oldSprite.visible = false
        newSprite.visible = true
        newSprite.alpha = 1
        onComplete?.()
        return
    }

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
    applyTransitionState(type, newSprite, 0, direction, "in")

    let blurFilter: BlurFilter | undefined
    if (type === "blur") {
        blurFilter = new BlurFilter({ strength: 20 })
        newSprite.filters = [blurFilter]
    }

    const transition: ActiveTransition = {
        state,
        oldSprite,
        newSprite,
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

    applyTransitionState(transition.state.type, transition.newSprite, t, transition.state.direction, "in")

    if (transition.oldSprite) {
        applyTransitionState(transition.state.type, transition.oldSprite, 1 - t, transition.state.direction, "out")
    }

    if (transition.blurFilter) {
        transition.blurFilter.strength = (1 - t) * 20
    }

    if (rawProgress >= 1) {
        completeTransition(id)
        return
    }

    transition.rafId = requestAnimationFrame((time) => tick(id, time))
}

function applyTransitionState(type: TransitionType, sprite: Sprite | Container, t: number, direction?: string, mode?: "in" | "out"): void {
    sprite.alpha = 1
    sprite.rotation = 0

    switch (type) {
        case "fade":
            sprite.alpha = t
            break

        case "blur":
            sprite.alpha = t
            break

        case "scale":
            sprite.scale.set(t, t)
            sprite.pivot.set(sprite.width / (2 * t || 1), sprite.height / (2 * t || 1))
            break

        case "spin":
            sprite.alpha = t
            sprite.rotation = (1 - t) * Math.PI * 2
            break

        case "slide": {
            const pos = (1 - t) * 100
            const parentWidth = sprite.parent?.width || 1920
            const parentHeight = sprite.parent?.height || 1080
            const isOut = mode === "out"

            sprite.x = 0
            sprite.y = 0

            if (direction === "left_right") sprite.x = (isOut ? 1 : -1) * (pos / 100) * parentWidth
            else if (direction === "right_left") sprite.x = (isOut ? -1 : 1) * (pos / 100) * parentWidth
            else if (direction === "bottom_top") sprite.y = (isOut ? -1 : 1) * (pos / 100) * parentHeight
            else if (direction === "top_bottom") sprite.y = (isOut ? 1 : -1) * (pos / 100) * parentHeight
            break
        }

        default:
            sprite.alpha = t
    }
}

function completeTransition(id: string): void {
    const transition = activeTransitions.get(id)
    if (!transition) return

    if (transition.oldSprite) {
        transition.oldSprite.visible = false
        transition.oldSprite.alpha = 1
        transition.oldSprite.rotation = 0
        transition.oldSprite.filters = []
    }

    transition.newSprite.alpha = 1
    transition.newSprite.rotation = 0
    transition.newSprite.filters = []

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
