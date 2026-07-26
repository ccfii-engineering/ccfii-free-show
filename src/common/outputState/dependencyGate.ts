import type { OutputTopicSnapshot } from "../../types/OutputState"

export interface OutputStateDependencyGate {
    receive: (snapshot: OutputTopicSnapshot) => void
    markApplied: (key: string, revision: number) => void
    takeReady: () => OutputTopicSnapshot | null
}

export function createDependencyGate(): OutputStateDependencyGate {
    const applied = new Map<string, number>()
    const pending = new Map<string, OutputTopicSnapshot>()
    const ready: OutputTopicSnapshot[] = []

    function receive(snapshot: OutputTopicSnapshot): void {
        const key = stateKey(snapshot)
        const previous = pending.get(key)
        if (previous && previous.revision > snapshot.revision) return

        if (dependenciesAreExact(snapshot)) {
            pending.delete(key)
            ready.push(snapshot)
            return
        }

        pending.set(key, snapshot)
    }

    function markApplied(key: string, revision: number): void {
        applied.set(key, revision)
        pending.forEach((snapshot, pendingKey) => {
            if (!dependenciesAreExact(snapshot)) return
            pending.delete(pendingKey)
            ready.push(snapshot)
        })
    }

    function dependenciesAreExact(snapshot: OutputTopicSnapshot): boolean {
        return Object.entries(snapshot.dependencies || {}).every(([key, revision]) => applied.get(key) === revision)
    }

    return { receive, markApplied, takeReady: () => ready.shift() ?? null }
}

function stateKey(snapshot: OutputTopicSnapshot): string {
    return snapshot.scope.kind === "shared" ? `${snapshot.topic}:shared` : `${snapshot.topic}:${snapshot.scope.outputId}`
}
