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
