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

        const key = this.options.snapshotKey(apply.snapshot.topic, apply.snapshot.scope)
        const current = this.applied.get(key)
        if (current?.revision === apply.snapshot.revision && current.contentHash === apply.snapshot.contentHash) {
            this.acknowledge(apply.snapshot)
            return true
        }
        if (current && current.revision >= apply.snapshot.revision) return this.reject("stale_revision", apply.snapshot)

        if (apply.snapshot.dependencies && Object.keys(apply.snapshot.dependencies).length) {
            this.options.dependencyGate.receive(apply.snapshot)
            await this.applyReadySnapshots()
            return true
        }

        const didApply = await this.applySnapshot(apply.snapshot)
        if (didApply) {
            this.options.dependencyGate.markApplied(key, apply.snapshot.revision)
            await this.applyReadySnapshots()
        }
        return didApply
    }

    private async applyReadySnapshots(): Promise<void> {
        let snapshot = this.options.dependencyGate.takeReady()
        while (snapshot) {
            await this.applySnapshot(snapshot)
            snapshot = this.options.dependencyGate.takeReady()
        }
    }

    private async applySnapshot(snapshot: OutputTopicSnapshot): Promise<boolean> {
        const key = this.options.snapshotKey(snapshot.topic, snapshot.scope)
        const current = this.applied.get(key)
        if (current && current.revision >= snapshot.revision) return current.revision === snapshot.revision && current.contentHash === snapshot.contentHash

        try {
            await this.options.applyTopic(snapshot)
            await this.options.afterApply()
        } catch {
            return this.reject("invalid_snapshot", snapshot)
        }

        this.applied.set(key, { revision: snapshot.revision, contentHash: snapshot.contentHash })
        this.acknowledge(snapshot)
        if (snapshot.topic === "output" && (snapshot.payload as any).out?.presentationMode === "cleared") this.options.send({ channel: "OUTPUT_STATE_RENDERED", data: { ...this.observation(snapshot), status: "rendered", failures: [] } })
        return true
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
