import type { Styles } from "../../types/Settings"

export function resolvePresenterStyleLines(style: Styles | undefined, defaultLayers: string[]) {
    const layers = style?.layers || defaultLayers
    const lines = Number(style?.lines || 0)
    return layers.includes("slide") && Number.isFinite(lines) && lines > 0 ? lines : 0
}
