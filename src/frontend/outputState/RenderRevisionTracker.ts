export interface RenderRevisionResult {
    revision: number
    status: "rendered" | "render_failed"
    failures: { layer: string; reason: string }[]
}

export class RenderRevisionTracker {
    private revision: number
    private required = new Set<string>()
    private terminal = new Set<string>()
    private failures = new Map<string, string>()

    constructor(revision: number, requiredLayers: string[]) {
        this.revision = revision
        this.required = new Set(requiredLayers)
    }

    start(revision: number, requiredLayers: string[]): void {
        this.revision = revision
        this.required = new Set(requiredLayers)
        this.terminal.clear()
        this.failures.clear()
    }

    completeFor(revision: number, layer: string): void {
        if (revision !== this.revision || !this.required.has(layer)) return
        this.terminal.add(layer)
        this.failures.delete(layer)
    }

    failFor(revision: number, layer: string, reason: string): void {
        if (revision !== this.revision || !this.required.has(layer)) return
        this.terminal.add(layer)
        this.failures.set(layer, reason)
    }

    result(): RenderRevisionResult | null {
        if ([...this.required].some((layer) => !this.terminal.has(layer))) return null
        const failures = [...this.failures].map(([layer, reason]) => ({ layer, reason }))
        return { revision: this.revision, status: failures.length ? "render_failed" : "rendered", failures }
    }
}
