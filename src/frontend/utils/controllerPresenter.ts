import type { Styles } from "../../types/Settings"

export function resolvePresenterStyleLines(style: Styles | undefined, defaultLayers: string[]) {
    const layers = style?.layers || defaultLayers
    const lines = Number(style?.lines || 0)
    return layers.includes("slide") && Number.isFinite(lines) && lines > 0 ? lines : 0
}

// Layout refs (`_show().layouts().ref()`) keep a slide's background media id under `data`, not at the top level.
// Rendered imports (PowerPoint, PDF) have empty slides, so this id is the only thing that makes their preview visible.
export function getPresenterBackgroundId(layoutSlide: { data?: { background?: string }; background?: string } | undefined) {
    return layoutSlide?.data?.background || layoutSlide?.background || ""
}

type Size = { width: number; height: number }
const DEFAULT_SIZE = { width: 1920, height: 1080 }

// The coordinate space the draw layer uses inside the slide. Zoomed.svelte scales the slide content by the slide width
// against 1920, or by the slide height against 1080 when a 16:9 style sits in a portrait window. Keep this in sync with it.
export function getDrawSpace(windowSize: Size, styleResolution: Size): Size {
    const styleAspectRatio = styleResolution.width / styleResolution.height
    const usesHeight = windowSize.width < windowSize.height && styleAspectRatio > 1 && styleAspectRatio === DEFAULT_SIZE.width / DEFAULT_SIZE.height
    if (usesHeight) return { width: DEFAULT_SIZE.height * styleAspectRatio, height: DEFAULT_SIZE.height }
    return { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.width / styleAspectRatio }
}

// The Controller sends a touch as a fraction of the whole output window, but the draw layer sits inside the slide,
// which is scaled to fit and centered in that window. Map the window fraction to a point in draw space.
export function windowOffsetToSlide(offset: { x: number; y: number }, windowSize: Size, styleResolution: Size) {
    const space = getDrawSpace(windowSize, styleResolution)
    if (!windowSize.width || !windowSize.height) return { x: offset.x * space.width, y: offset.y * space.height }

    const scale = Math.min(windowSize.width / space.width, windowSize.height / space.height)
    const left = (windowSize.width - space.width * scale) / 2
    const top = (windowSize.height - space.height * scale) / 2
    const x = (offset.x * windowSize.width - left) / scale
    const y = (offset.y * windowSize.height - top) / scale

    return { x: Math.max(0, Math.min(x, space.width)), y: Math.max(0, Math.min(y, space.height)) }
}
