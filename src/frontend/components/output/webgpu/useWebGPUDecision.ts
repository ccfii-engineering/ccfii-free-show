import type { Output } from "../../../../types/Output"

interface DecisionInput {
    special: { useWebGPUOutput?: boolean }
    output: Pick<Output, "useWebGPU" | "stageOutput" | "out"> | any
}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "avi", "mkv"])

/**
 * Decide whether a given output instance should render via WebGPUOutput (Pixi-backed) or the
 * legacy DOM Output. Stage outputs always use DOM because they render via StageLayout and don't
 * need media transition smoothness. Per-output `useWebGPU=false` is an explicit opt-out that
 * overrides the global flag. The global `special.useWebGPUOutput` must be explicitly true —
 * an undefined global defaults to off so fresh installs get the known-good DOM path.
 */
export function shouldUseWebGPU({ special, output }: DecisionInput): boolean {
    if (output?.stageOutput) return false
    if (special?.useWebGPUOutput !== true) return false
    if (output?.useWebGPU === false) return false
    if (hasVideoBackground(output)) return false
    return true
}

function hasVideoBackground(output: DecisionInput["output"]): boolean {
    const background = output?.out?.background
    if (!background) return false
    if (background.type === "video" || background.type === "player") return true

    const path = background.path || background.id || ""
    const extension = String(path).split(".").pop()?.toLowerCase() || ""
    return VIDEO_EXTENSIONS.has(extension)
}
