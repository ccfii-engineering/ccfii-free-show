// ----- FreeShow -----
// Launch-time runtime overrides that must survive wholesale store replacement
// (e.g., persisted settings loading replaces the whole special store)

let gpuVideoLifecycleQualified = false

export function setLaunchGpuVideoLifecycleQualified(value: boolean) {
    gpuVideoLifecycleQualified = value
}

export function withLaunchGpuVideoLifecycleQualified(values: any) {
    return gpuVideoLifecycleQualified ? { ...values, gpuVideoLifecycleQualified: true } : values
}
