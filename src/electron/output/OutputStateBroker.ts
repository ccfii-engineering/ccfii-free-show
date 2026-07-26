import type { OutputStateApply, OutputStateHealth, OutputStateManifest, OutputStateObservation, OutputStateReady, OutputStateRejection, OutputStateRendered, OutputStateScope, OutputStateToMainMessage, OutputStateToRendererMessage, OutputStateTopic, OutputTopicSnapshot } from "../../types/OutputState"

type TimerHandle = unknown

interface OutputStateBrokerScheduler {
    now: () => number
    setTimeout: (callback: () => void, delay: number) => TimerHandle
    clearTimeout: (handle: TimerHandle) => void
}

interface OutputStateBrokerTransport {
    sendToOutput: (outputId: string, message: OutputStateToRendererMessage) => void
    sendToMain: (message: OutputStateToMainMessage) => void
    recreateOutput: (outputId: string) => void
}

interface OutputStateBrokerOptions {
    requiredSharedTopics: OutputStateTopic[]
    requiredOutputTopics?: OutputStateTopic[]
    validateSnapshot: (value: unknown) => value is OutputTopicSnapshot
    snapshotKey: (topic: OutputStateTopic, scope: OutputStateScope) => string
    scheduler?: OutputStateBrokerScheduler
    transport: OutputStateBrokerTransport
}

interface PendingDelivery {
    snapshot: OutputTopicSnapshot
    retryCount: number
    timer?: TimerHandle
}

interface OutputSession {
    outputId: string
    sessionId: string
    pending: Map<string, PendingDelivery>
}

const RETRY_DELAYS = [500, 1000, 2000]
const RECREATE_CIRCUIT_WINDOW = 30_000

const defaultScheduler: OutputStateBrokerScheduler = {
    now: Date.now,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export class OutputStateBroker {
    private readonly requiredSharedTopics: OutputStateTopic[]
    private readonly requiredOutputTopics: OutputStateTopic[]
    private readonly validateSnapshot: OutputStateBrokerOptions["validateSnapshot"]
    private readonly snapshotKey: OutputStateBrokerOptions["snapshotKey"]
    private readonly scheduler: OutputStateBrokerScheduler
    private readonly transport: OutputStateBrokerTransport
    private readonly snapshots = new Map<string, OutputTopicSnapshot>()
    private readonly sessions = new Map<string, OutputSession>()
    private readonly lastRecreate = new Map<string, number>()

    constructor(options: OutputStateBrokerOptions) {
        this.requiredSharedTopics = options.requiredSharedTopics
        this.requiredOutputTopics = options.requiredOutputTopics ?? ["output"]
        this.validateSnapshot = options.validateSnapshot
        this.snapshotKey = options.snapshotKey
        this.scheduler = options.scheduler ?? defaultScheduler
        this.transport = options.transport
    }

    publish(snapshot: OutputTopicSnapshot): boolean {
        if (!this.validateSnapshot(snapshot)) return false

        const key = this.snapshotKey(snapshot.topic, snapshot.scope)
        const previous = this.snapshots.get(key)
        if (previous && previous.revision >= snapshot.revision) return false

        this.snapshots.set(key, snapshot)
        this.sessions.forEach((session) => {
            if (!this.belongsToSession(snapshot.scope, session.outputId)) return
            this.deliver(session, snapshot)
        })
        return true
    }

    ready(ready: OutputStateReady, authenticatedOutputId: string): boolean {
        if (ready.outputId !== authenticatedOutputId || ready.protocolVersion !== 1 || !ready.sessionId) return false

        this.removeSession(authenticatedOutputId)
        const session: OutputSession = { outputId: authenticatedOutputId, sessionId: ready.sessionId, pending: new Map() }
        this.sessions.set(authenticatedOutputId, session)

        const requiredKeys = this.requiredKeys(authenticatedOutputId)
        const available = requiredKeys.map((key) => this.snapshots.get(this.snapshotKey(key.topic, key.scope))).filter((snapshot): snapshot is OutputTopicSnapshot => !!snapshot)
        const manifest: OutputStateManifest = {
            outputId: authenticatedOutputId,
            sessionId: ready.sessionId,
            protocolVersion: 1,
            entries: available.map(({ topic, scope, revision, contentHash }) => ({ topic, scope, revision, contentHash }))
        }
        this.transport.sendToOutput(authenticatedOutputId, { channel: "OUTPUT_STATE_MANIFEST", data: manifest })

        const missing = requiredKeys.filter((key) => !this.snapshots.has(this.snapshotKey(key.topic, key.scope)))
        if (missing.length) this.transport.sendToMain({ channel: "OUTPUT_STATE_NEEDED", data: { keys: missing } })

        available.forEach((snapshot) => this.deliver(session, snapshot))
        if (!available.length) this.reportHealth(session, { status: "syncing", reason: "waiting_for_authoritative_state" })
        return true
    }

    applied(observation: OutputStateObservation, authenticatedOutputId: string): boolean {
        const session = this.sessions.get(authenticatedOutputId)
        if (!session || observation.outputId !== authenticatedOutputId || observation.sessionId !== session.sessionId) return false

        const key = this.snapshotKey(observation.topic, observation.scope)
        const pending = session.pending.get(key)
        if (!pending || pending.snapshot.revision !== observation.revision || pending.snapshot.contentHash !== observation.contentHash) return false

        this.clearDelivery(pending)
        session.pending.delete(key)
        this.reportHealth(session, session.pending.size ? { status: "syncing", topic: observation.topic, revision: observation.revision } : { status: "healthy", topic: observation.topic, revision: observation.revision })
        return true
    }

    rendered(observation: OutputStateRendered, authenticatedOutputId: string): boolean {
        const session = this.sessions.get(authenticatedOutputId)
        if (!session || !this.matchesCurrentSnapshot(observation, session, authenticatedOutputId)) return false

        if (observation.status === "render_failed") {
            this.reportHealth(session, { status: "render_failed", topic: observation.topic, revision: observation.revision, reason: observation.failures?.map(({ layer, reason }) => `${layer}:${reason}`).join(",") || "render_failed" })
        }
        return true
    }

    rejected(rejection: OutputStateRejection, authenticatedOutputId: string): boolean {
        const session = this.sessions.get(authenticatedOutputId)
        if (!session || rejection.outputId !== authenticatedOutputId || rejection.sessionId !== session.sessionId) return false

        this.reportHealth(session, { status: "unhealthy", topic: rejection.topic, revision: rejection.revision, reason: rejection.reason })
        return true
    }

    removeSession(outputId: string): void {
        const session = this.sessions.get(outputId)
        if (!session) return
        session.pending.forEach((delivery) => this.clearDelivery(delivery))
        this.sessions.delete(outputId)
    }

    dispose(): void {
        ;[...this.sessions.keys()].forEach((outputId) => this.removeSession(outputId))
    }

    private deliver(session: OutputSession, snapshot: OutputTopicSnapshot): void {
        const key = this.snapshotKey(snapshot.topic, snapshot.scope)
        const previous = session.pending.get(key)
        if (previous) this.clearDelivery(previous)

        const delivery: PendingDelivery = { snapshot, retryCount: 0 }
        session.pending.set(key, delivery)
        this.sendApply(session, snapshot)
        this.reportHealth(session, { status: "syncing", topic: snapshot.topic, revision: snapshot.revision })
        this.scheduleRetry(session, key, delivery)
    }

    private scheduleRetry(session: OutputSession, key: string, delivery: PendingDelivery): void {
        const delay = RETRY_DELAYS[delivery.retryCount]
        delivery.timer = this.scheduler.setTimeout(() => {
            if (this.sessions.get(session.outputId) !== session || session.pending.get(key) !== delivery) return

            if (delivery.retryCount >= RETRY_DELAYS.length - 1) {
                this.deliveryFailed(session, delivery)
                return
            }

            delivery.retryCount += 1
            this.sendApply(session, delivery.snapshot)
            this.reportHealth(session, { status: "retrying", topic: delivery.snapshot.topic, revision: delivery.snapshot.revision, retryCount: delivery.retryCount })
            this.scheduleRetry(session, key, delivery)
        }, delay)
    }

    private deliveryFailed(session: OutputSession, delivery: PendingDelivery): void {
        const previousRecreate = this.lastRecreate.get(session.outputId)
        const canRecreate = previousRecreate === undefined || this.scheduler.now() - previousRecreate >= RECREATE_CIRCUIT_WINDOW
        const health: Partial<OutputStateHealth> = {
            status: canRecreate ? "recovering" : "unhealthy",
            topic: delivery.snapshot.topic,
            revision: delivery.snapshot.revision,
            retryCount: RETRY_DELAYS.length,
            reason: "acknowledgement_timeout"
        }

        this.reportHealth(session, health as Pick<OutputStateHealth, "status"> & Partial<OutputStateHealth>)
        this.removeSession(session.outputId)
        if (!canRecreate) return

        this.lastRecreate.set(session.outputId, this.scheduler.now())
        this.transport.recreateOutput(session.outputId)
    }

    private sendApply(session: OutputSession, snapshot: OutputTopicSnapshot): void {
        const apply: OutputStateApply = { outputId: session.outputId, sessionId: session.sessionId, snapshot }
        this.transport.sendToOutput(session.outputId, { channel: "OUTPUT_STATE_APPLY", data: apply })
    }

    private reportHealth(session: OutputSession, health: Pick<OutputStateHealth, "status"> & Partial<OutputStateHealth>): void {
        this.transport.sendToMain({ channel: "OUTPUT_STATE_HEALTH", data: { outputId: session.outputId, sessionId: session.sessionId, ...health } })
    }

    private clearDelivery(delivery: PendingDelivery): void {
        if (delivery.timer !== undefined) this.scheduler.clearTimeout(delivery.timer)
        delivery.timer = undefined
    }

    private belongsToSession(scope: OutputStateScope, outputId: string): boolean {
        return scope.kind === "shared" || scope.outputId === outputId
    }

    private matchesCurrentSnapshot(observation: OutputStateObservation, session: OutputSession, authenticatedOutputId: string): boolean {
        if (observation.outputId !== authenticatedOutputId || observation.sessionId !== session.sessionId) return false
        const snapshot = this.snapshots.get(this.snapshotKey(observation.topic, observation.scope))
        return !!snapshot && snapshot.revision === observation.revision && snapshot.contentHash === observation.contentHash
    }

    private requiredKeys(outputId: string): { topic: OutputStateTopic; scope: OutputStateScope }[] {
        return [...this.requiredSharedTopics.map((topic) => ({ topic, scope: { kind: "shared" } as const })), ...this.requiredOutputTopics.map((topic) => ({ topic, scope: { kind: "output", outputId } as const }))]
    }
}
