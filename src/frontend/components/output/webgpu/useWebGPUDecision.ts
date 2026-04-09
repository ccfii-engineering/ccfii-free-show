import type { Output } from "../../../../types/Output"

interface DecisionInput {
    special: { useWebGPUOutput?: boolean }
    output: Pick<Output, "useWebGPU" | "stageOutput"> | any
}

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
    return true
}
