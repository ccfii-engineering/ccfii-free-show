// Parses CSS-like animation style strings emitted by src/frontend/components/output/animation.ts
// and applies equivalent transforms to Pixi sprites. This is what makes Ken-Burns / zoom / rotate
// slide background animations work on the GPU output path.

import type { Container, Sprite } from "pixi.js"

export interface ParsedAnimation {
    scale: number
    translateX: number // percentage of baseline width, relative to center
    translateY: number // percentage of baseline height, relative to center
    rotation: number // radians
    filter: string
    duration: number // ms
    easing: string
}

const IDENTITY: ParsedAnimation = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    rotation: 0,
    filter: "",
    duration: 0,
    easing: "linear"
}

export function parseAnimationStyle(style: string | null | undefined): ParsedAnimation {
    if (!style) return { ...IDENTITY }
    const result: ParsedAnimation = { ...IDENTITY }

    const transformMatch = style.match(/transform\s*:\s*([^;]+);?/)
    if (transformMatch) {
        const t = transformMatch[1]
        const scaleMatch = t.match(/scale\(\s*([-0-9.]+)\s*\)/)
        if (scaleMatch) result.scale = parseFloat(scaleMatch[1])

        const translateMatch = t.match(/translate\(\s*([-0-9.]+)%\s*,\s*([-0-9.]+)%\s*\)/)
        if (translateMatch) {
            result.translateX = parseFloat(translateMatch[1])
            result.translateY = parseFloat(translateMatch[2])
        }

        const rotateMatch = t.match(/rotate\(\s*([-0-9.]+)deg\s*\)/)
        if (rotateMatch) result.rotation = (parseFloat(rotateMatch[1]) * Math.PI) / 180
    }

    const filterMatch = style.match(/filter\s*:\s*([^;]+);?/)
    if (filterMatch) result.filter = filterMatch[1].trim()

    const transitionMatch = style.match(/transition\s*:\s*([^;]+);?/)
    if (transitionMatch) {
        const parts = transitionMatch[1]
        const msMatch = parts.match(/([0-9.]+)ms/)
        const sMatch = parts.match(/([0-9.]+)s(?!ec)/)
        if (msMatch) result.duration = parseFloat(msMatch[1])
        else if (sMatch) result.duration = parseFloat(sMatch[1]) * 1000
        const easingMatch = parts.match(/\b(linear|ease|ease-in|ease-out|ease-in-out)\b/)
        if (easingMatch) result.easing = easingMatch[1]
    }

    return result
}

// Easing functions for the tween — matching CSS cubic-bezier approximations
function easeFn(name: string): (t: number) => number {
    switch (name) {
        case "linear":
            return (t: number) => t
        case "ease-in":
            return (t: number) => t * t
        case "ease-out":
            return (t: number) => t * (2 - t)
        case "ease":
        case "ease-in-out":
        default:
            return (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
    }
}

interface AnimationRun {
    rafId: number
    startTime: number
    duration: number
    ease: (t: number) => number
    fromScale: number
    toScale: number
    fromX: number
    toX: number
    fromY: number
    toY: number
    fromRot: number
    toRot: number
}

const runs = new WeakMap<Sprite | Container, AnimationRun>()

/**
 * Start (or restart) an animation on the sprite by lerping from its current pose to the target
 * pose parsed from `animationStyle`. The sprite's current x/y/width/height is used as the
 * baseline — this is the pose after applyFit's layout computation. We lerp deltas on top.
 * If a previous animation is running on the same sprite, it's cancelled first.
 */
export function applyAnimation(
    sprite: Sprite | Container | null,
    layerWidth: number,
    layerHeight: number,
    animationStyle: string
): void {
    if (!sprite) return

    const existing = runs.get(sprite)
    if (existing) cancelAnimationFrame(existing.rafId)

    const parsed = parseAnimationStyle(animationStyle)
    if (!animationStyle || animationStyle.length === 0) {
        runs.delete(sprite)
        return
    }

    // Current sprite pose is the baseline (after applyFit)
    const baseW = sprite.width || layerWidth
    const baseH = sprite.height || layerHeight
    const baseX = sprite.x
    const baseY = sprite.y
    const centerX = baseX + baseW / 2
    const centerY = baseY + baseH / 2

    // Target pose — scale from center, translate % relative to baseline w/h
    const targetW = baseW * parsed.scale
    const targetH = baseH * parsed.scale
    const targetCX = centerX + (parsed.translateX / 100) * baseW
    const targetCY = centerY + (parsed.translateY / 100) * baseH
    const targetX = targetCX - targetW / 2
    const targetY = targetCY - targetH / 2

    // Instant (no transition) — snap to target and return
    if (parsed.duration <= 0) {
        const s = sprite as any
        if (s.scale?.set) s.scale.set(parsed.scale, parsed.scale)
        sprite.x = targetX
        sprite.y = targetY
        sprite.rotation = parsed.rotation
        runs.delete(sprite)
        return
    }

    const sref = sprite as any
    const fromScale = (sref.scale?.x as number | undefined) ?? 1
    const run: AnimationRun = {
        rafId: 0,
        startTime: performance.now(),
        duration: parsed.duration,
        ease: easeFn(parsed.easing),
        fromScale,
        toScale: parsed.scale,
        fromX: baseX,
        toX: targetX,
        fromY: baseY,
        toY: targetY,
        fromRot: sprite.rotation,
        toRot: parsed.rotation
    }

    const step = (now: number) => {
        const raw = Math.min(1, (now - run.startTime) / run.duration)
        const t = run.ease(raw)
        const sc = run.fromScale + (run.toScale - run.fromScale) * t
        sref.scale?.set?.(sc, sc)
        sprite.x = run.fromX + (run.toX - run.fromX) * t
        sprite.y = run.fromY + (run.toY - run.fromY) * t
        sprite.rotation = run.fromRot + (run.toRot - run.fromRot) * t
        if (raw < 1) run.rafId = requestAnimationFrame(step)
        else runs.delete(sprite)
    }
    run.rafId = requestAnimationFrame(step)
    runs.set(sprite, run)
}

export function cancelAnimation(sprite: Sprite | Container | null): void {
    if (!sprite) return
    const r = runs.get(sprite)
    if (r) {
        cancelAnimationFrame(r.rafId)
        runs.delete(sprite)
    }
}
