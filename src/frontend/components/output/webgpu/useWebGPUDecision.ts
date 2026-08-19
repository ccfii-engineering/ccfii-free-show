import type { Output } from "../../../../types/Output"

interface DecisionInput {
    special: { useWebGPUOutput?: boolean }
    output: Pick<Output, "useWebGPU" | "stageOutput" | "out"> | any
    sessionFallback?: boolean
}

/**
 * Decide whether a given output instance should render via the GPU output (Pixi-backed) or the
 * legacy DOM Output. Stage outputs always use DOM because they render via StageLayout and don't
 * need media transition smoothness. Per-output `useWebGPU=false` is an explicit opt-out that
 * overrides the global flag. `useWebGPUOutput` and `useWebGPU` are retained serialized setting
 * names; the runtime may qualify WebGPU or the WebGL compatibility backend.
 */
export function shouldUseGPUOutput({ special, output, sessionFallback }: DecisionInput): boolean {
    if (output?.stageOutput) return false
    if (sessionFallback) return false
    if (special?.useWebGPUOutput === false) return false
    if (output?.useWebGPU === false) return false
    return true
}
