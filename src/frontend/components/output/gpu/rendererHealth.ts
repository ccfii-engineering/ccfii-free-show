import type { OutputStateHealth } from "../../../../types/OutputState"

export function describeRendererHealth(health: Pick<OutputStateHealth, "rendererState" | "backend" | "reason"> | undefined, explicitlyDisabled = false): string {
    if (explicitlyDisabled) return "GPU renderer: Explicit legacy opt-out"
    if (health?.rendererState === "gpu-active" && health.backend === "webgpu") return "GPU renderer: WebGPU active"
    if (health?.rendererState === "gpu-active" && health.backend === "webgl") return "GPU renderer: WebGL compatibility active"
    if (health?.rendererState === "recovering") return "GPU renderer: Recovering"
    if (health?.rendererState === "legacy-fallback") return `GPU renderer: Legacy fallback active${health.reason ? ` — ${formatReason(health.reason)}` : ""}`
    if (health?.rendererState === "failed") return `GPU renderer: Failed${health.reason ? ` — ${formatReason(health.reason)}` : ""}`
    if (health?.rendererState === "initializing") return "GPU renderer: Initializing"
    return "GPU renderer: Waiting for output"
}

function formatReason(reason: string): string {
    return reason.replaceAll("_", " ")
}
