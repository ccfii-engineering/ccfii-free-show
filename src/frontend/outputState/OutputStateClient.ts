import type { OutputStateDependencyGate } from "../../common/outputState/dependencyGate"
import type { OutputStateApply, OutputStateManifest, OutputStateObservation, OutputStateRejectionReason, OutputStateScope, OutputStateTopic, OutputTopicSnapshot } from "../../types/OutputState"

interface OutputStateClientOptions {
    outputId: string
    sessionId: string
    protocolVersion: number
    validateSnapshot: (value: unknown) => value is OutputTopicSnapshot
    snapshotKey: (topic: OutputStateTopic, scope: OutputStateScope) => string
    dependencyGate: OutputStateDependencyGate
    applyTopic: (snapshot: OutputTopicSnapshot) => Promise<void>
    afterApply: () => Promise<void>
    send: (message: { channel: string; data: unknown }) => void
}

export class OutputStateClient {
    private readonly options: OutputStateClientOptions
    private readonly applied = new Map<string, { revision: number; contentHash: string }>()
    private activeSnapshot: OutputTopicSnapshot | null = null
    private applyPump: Promise<void> | null = null
    private applyPumpRequested = false

    constructor(options: OutputStateClientOptions) {
        this.options = options
    }

    start(): void {
        this.options.send({ channel: "OUTPUT_STATE_READY", data: { outputId: this.options.outputId, sessionId: this.options.sessionId, protocolVersion: this.options.protocolVersion } })
    }

    receiveManifest(manifest: OutputStateManifest): boolean {
        return manifest.outputId === this.options.outputId && manifest.sessionId === this.options.sessionId && manifest.protocolVersion === this.options.protocolVersion
    }

    async receiveApply(apply: OutputStateApply): Promise<boolean> {
        if (apply.outputId !== this.options.outputId) return this.reject("wrong_output", apply.snapshot)
        if (apply.sessionId !== this.options.sessionId) return this.reject("wrong_session", apply.snapshot)
        if (!this.options.validateSnapshot(apply.snapshot)) return this.reject("invalid_snapshot", apply.snapshot)
        if (apply.snapshot.scope.kind === "output" && apply.snapshot.scope.outputId !== this.options.outputId) return this.reject("wrong_output", apply.snapshot)

        const snapshot = apply.snapshot
        const key = this.options.snapshotKey(snapshot.topic, snapshot.scope)
        const current = this.applied.get(key)
        if (current && current.revision > snapshot.revision) return this.reject("stale_revision", snapshot)
        if (current?.revision === snapshot.revision && current.contentHash !== snapshot.contentHash) return this.reject("stale_revision", snapshot)

        const active = this.activeSnapshot
        if (active && this.options.snapshotKey(active.topic, active.scope) === key) {
            if (active.revision > snapshot.revision) return this.reject("stale_revision", snapshot)
            if (active.revision === snapshot.revision) {
                return active.contentHash === snapshot.contentHash ? true : this.reject("stale_revision", snapshot)
            }
        }

        const received = this.options.dependencyGate.receive(snapshot)
        if (received === "stale") {
            if (current?.revision === snapshot.revision && current.contentHash === snapshot.contentHash) return true
            return this.reject("stale_revision", snapshot)
        }
        if (received === "conflict") return this.reject("stale_revision", snapshot)

        if (received === "duplicate") {
            if (current?.revision === snapshot.revision && current.contentHash === snapshot.contentHash && this.options.dependencyGate.isLatest(snapshot)) {
                if (this.options.dependencyGate.dependenciesSuperseded(snapshot)) this.reject("missing_dependency", snapshot)
                else this.acknowledge(snapshot)
            } else await this.pumpApplications()
            return true
        }

        await this.pumpApplications()
        return true
    }

    private pumpApplications(): Promise<void> {
        this.applyPumpRequested = true
        if (this.applyPump) return this.applyPump

        let resolvePump = () => {}
        let rejectPump: (error: unknown) => void = () => {}
        const pump = new Promise<void>((resolve, reject) => {
            resolvePump = resolve
            rejectPump = reject
        })
        this.applyPump = pump
        void this.drainApplyPump().then(resolvePump, (error) => {
            if (this.applyPump === pump) this.applyPump = null
            rejectPump(error)
        })
        return this.applyPump
    }

    private async drainApplyPump(): Promise<void> {
        while (true) {
            this.applyPumpRequested = false
            await this.runApplyPump()
            await Promise.resolve()
            if (this.applyPumpRequested) continue

            this.applyPump = null
            return
        }
    }

    private async runApplyPump(): Promise<void> {
        while (true) {
            const { snapshot, superseded } = this.options.dependencyGate.takeReady()
            superseded.forEach((candidate) => {
                if (this.options.dependencyGate.isLatest(candidate)) this.reject("missing_dependency", candidate)
            })
            if (!snapshot) return

            const key = this.options.snapshotKey(snapshot.topic, snapshot.scope)
            const current = this.applied.get(key)
            if (current && current.revision >= snapshot.revision) {
                if (current.revision === snapshot.revision && current.contentHash === snapshot.contentHash && this.options.dependencyGate.isLatest(snapshot)) this.acknowledge(snapshot)
                continue
            }

            this.activeSnapshot = snapshot
            let applied = false
            try {
                await this.options.applyTopic(snapshot)
                await this.options.afterApply()
                applied = true
            } catch {
                if (this.options.dependencyGate.isLatest(snapshot)) this.reject("invalid_snapshot", snapshot)
            } finally {
                this.activeSnapshot = null
            }

            if (!applied) continue

            this.applied.set(key, { revision: snapshot.revision, contentHash: snapshot.contentHash })
            this.options.dependencyGate.markApplied(key, snapshot.revision)

            if (!this.options.dependencyGate.isLatest(snapshot)) continue
            if (this.options.dependencyGate.dependenciesSuperseded(snapshot)) {
                this.reject("missing_dependency", snapshot)
                continue
            }

            this.acknowledge(snapshot)
            if (snapshot.topic === "output" && (snapshot.payload as any).out?.presentationMode === "cleared") this.options.send({ channel: "OUTPUT_STATE_RENDERED", data: { ...this.observation(snapshot), status: "rendered", failures: [] } })
        }
    }

    private acknowledge(snapshot: OutputTopicSnapshot): void {
        this.options.send({ channel: "OUTPUT_STATE_APPLIED", data: this.observation(snapshot) })
    }

    private reject(reason: OutputStateRejectionReason, snapshot?: OutputTopicSnapshot): false {
        this.options.send({ channel: "OUTPUT_STATE_REJECTED", data: { ...this.observation(snapshot), reason } })
        return false
    }

    private observation(snapshot?: OutputTopicSnapshot): OutputStateObservation {
        return {
            outputId: this.options.outputId,
            sessionId: this.options.sessionId,
            topic: snapshot?.topic ?? "output",
            scope: snapshot?.scope ?? { kind: "output", outputId: this.options.outputId },
            revision: snapshot?.revision ?? 0,
            contentHash: snapshot?.contentHash ?? ""
        }
    }
}
