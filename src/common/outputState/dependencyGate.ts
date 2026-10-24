import type { OutputTopicSnapshot } from "../../types/OutputState"

export type OutputStateDependencyGateResult = "accepted" | "duplicate" | "stale" | "conflict"

export interface OutputStateDependencyGate {
    receive: (snapshot: OutputTopicSnapshot) => OutputStateDependencyGateResult
    markApplied: (key: string, revision: number) => void
    takeReady: () => { snapshot: OutputTopicSnapshot | null; superseded: OutputTopicSnapshot[] }
    isLatest: (snapshot: OutputTopicSnapshot) => boolean
    dependenciesSuperseded: (snapshot: OutputTopicSnapshot) => boolean
}

export function createDependencyGate(): OutputStateDependencyGate {
    const applied = new Map<string, number>()
    const latest = new Map<string, OutputTopicSnapshot>()
    const pending = new Map<string, OutputTopicSnapshot>()

    function receive(snapshot: OutputTopicSnapshot): OutputStateDependencyGateResult {
        const key = stateKey(snapshot)
        const previous = latest.get(key)
        if (previous && previous.revision > snapshot.revision) return "stale"
        if (previous?.revision === snapshot.revision) {
            if (previous.contentHash !== snapshot.contentHash) return "conflict"
            if (!pending.has(key) && (applied.get(key) ?? 0) < snapshot.revision) pending.set(key, snapshot)
            return "duplicate"
        }

        latest.set(key, snapshot)
        pending.set(key, snapshot)
        return "accepted"
    }

    function markApplied(key: string, revision: number): void {
        const previous = applied.get(key) ?? 0
        if (revision > previous) applied.set(key, revision)
    }

    function takeReady(): { snapshot: OutputTopicSnapshot | null; superseded: OutputTopicSnapshot[] } {
        const superseded: OutputTopicSnapshot[] = []

        for (const [key, snapshot] of pending) {
            if (!isLatest(snapshot)) {
                pending.delete(key)
                continue
            }

            if (dependenciesSuperseded(snapshot)) {
                pending.delete(key)
                superseded.push(snapshot)
                continue
            }

            if (dependenciesAreExact(snapshot)) {
                pending.delete(key)
                return { snapshot, superseded }
            }
        }

        return { snapshot: null, superseded }
    }

    function isLatest(snapshot: OutputTopicSnapshot): boolean {
        const current = latest.get(stateKey(snapshot))
        return current?.revision === snapshot.revision && current.contentHash === snapshot.contentHash
    }

    function dependenciesSuperseded(snapshot: OutputTopicSnapshot): boolean {
        return Object.entries(snapshot.dependencies || {}).some(([key, revision]) => {
            const appliedRevision = applied.get(key)
            const latestRevision = latest.get(key)?.revision
            return (appliedRevision !== undefined && appliedRevision > revision) || (latestRevision !== undefined && latestRevision > revision)
        })
    }

    function dependenciesAreExact(snapshot: OutputTopicSnapshot): boolean {
        return Object.entries(snapshot.dependencies || {}).every(([key, revision]) => applied.get(key) === revision)
    }

    return { receive, markApplied, takeReady, isLatest, dependenciesSuperseded }
}

function stateKey(snapshot: OutputTopicSnapshot): string {
    return snapshot.scope.kind === "shared" ? `${snapshot.topic}:shared` : `${snapshot.topic}:${snapshot.scope.outputId}`
}
