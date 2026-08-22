import type { Output } from "../../../../types/Output"

interface DecisionInput {
    special: { useWebGPUOutput?: boolean; gpuVideoLifecycleQualified?: boolean }
    output: Pick<Output, "useWebGPU" | "stageOutput" | "out"> | any
    sessionFallback?: boolean
}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "avi", "mkv"])

/**
 * Decide whether a given output instance should render via the GPU output (Pixi-backed) or the
 * legacy DOM Output. Stage outputs always use DOM because they render via StageLayout and don't
 * need media transition smoothness. Per-output `useWebGPU=false` is an explicit opt-out that
 * overrides the global flag. Video backgrounds stay on the legacy renderer until the GPU video
 * lifecycle is explicitly qualified; this keeps the shared VideoPlayer contract authoritative for
 * progress, duration, audio, and loop behavior. `useWebGPUOutput` and `useWebGPU` are retained
 * serialized setting names; the runtime may qualify WebGPU or the WebGL compatibility backend.
 */
export function shouldUseGPUOutput({ special, output, sessionFallback }: DecisionInput): boolean {
    if (output?.stageOutput) return false
    if (sessionFallback) return false
    if (special?.useWebGPUOutput === false) return false
    if (output?.useWebGPU === false) return false
    const background = output?.out?.background
    if (!hasVideoBackground(background)) return true
    // bounded/custom loop semantics are a documented legacy-only capability (#17):
    // never silently change their meaning, even for qualified GPU video
    if (hasUnsupportedLoopSemantics(background)) return false
    return special?.gpuVideoLifecycleQualified === true
}

function hasVideoBackground(background: any): boolean {
    if (!background) return false
    if (background.type === "video" || background.type === "player") return true

    const mediaPath = background.path || background.id || ""
    const extension = String(mediaPath).split(".").pop()?.toLowerCase() || ""
    return VIDEO_EXTENSIONS.has(extension)
}

// GPU video only supports native whole-file looping today (#17)
function hasUnsupportedLoopSemantics(background: any): boolean {
    return Number(background.startAt) > 0 || Number(background.softLoop) > 0
}
