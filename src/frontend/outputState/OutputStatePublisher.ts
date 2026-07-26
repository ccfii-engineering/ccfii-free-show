import type { Output } from "../../types/Output"
import type { OutputStateDependencies, OutputStatePayloadByTopic, OutputStateScope, OutputStateTopic, OutputTopicSnapshot } from "../../types/OutputState"

interface OutputStatePublisherOptions {
    createSnapshot: <T extends OutputStateTopic>(topic: T, scope: OutputStateScope, revision: number, payload: OutputStatePayloadByTopic[T], dependencies?: OutputStateDependencies) => OutputTopicSnapshot<T>
    fingerprint: (value: unknown) => string
    outputDependencies: OutputStateTopic[]
}

export interface OutputStatePublisher {
    publish<T extends OutputStateTopic>(topic: T, scope: OutputStateScope, payload: OutputStatePayloadByTopic[T], dependencies?: OutputStateDependencies): OutputTopicSnapshot<T>
    publishIfChanged<T extends OutputStateTopic>(topic: T, scope: OutputStateScope, payload: OutputStatePayloadByTopic[T], dependencies?: OutputStateDependencies): OutputTopicSnapshot<T> | null
    publishOutput(outputId: string, output: Output): OutputTopicSnapshot<"output">
    getRevision(topic: OutputStateTopic, scope: OutputStateScope): number
}

export function createOutputStatePublisher(sendSnapshot: (snapshot: OutputTopicSnapshot) => void, options: OutputStatePublisherOptions): OutputStatePublisher {
    const revisions = new Map<string, number>()
    const fingerprints = new Map<string, string>()

    function publish<T extends OutputStateTopic>(topic: T, scope: OutputStateScope, payload: OutputStatePayloadByTopic[T], dependencies?: OutputStateDependencies): OutputTopicSnapshot<T> {
        const key = stateKey(topic, scope)
        const revision = (revisions.get(key) ?? 0) + 1
        const snapshot = options.createSnapshot(topic, scope, revision, payload, dependencies)

        revisions.set(key, revision)
        fingerprints.set(key, options.fingerprint(payload))
        sendSnapshot(snapshot)
        return snapshot
    }

    function publishIfChanged<T extends OutputStateTopic>(topic: T, scope: OutputStateScope, payload: OutputStatePayloadByTopic[T], dependencies?: OutputStateDependencies): OutputTopicSnapshot<T> | null {
        const key = stateKey(topic, scope)
        if (fingerprints.get(key) === options.fingerprint(payload)) return null
        return publish(topic, scope, payload, dependencies)
    }

    function publishOutput(outputId: string, output: Output): OutputTopicSnapshot<"output"> {
        const dependencies = options.outputDependencies.reduce<OutputStateDependencies>((result, topic) => {
            const key = stateKey(topic, { kind: "shared" })
            const revision = revisions.get(key)
            if (!revision) throw new Error(`Cannot publish output before observing dependency ${key}`)
            result[key] = revision
            return result
        }, {})

        return publish("output", { kind: "output", outputId }, output, dependencies)
    }

    function getRevision(topic: OutputStateTopic, scope: OutputStateScope): number {
        return revisions.get(stateKey(topic, scope)) ?? 0
    }

    return { publish, publishIfChanged, publishOutput, getRevision }
}

function stateKey(topic: OutputStateTopic, scope: OutputStateScope): string {
    return scope.kind === "shared" ? `${topic}:shared` : `${topic}:${scope.outputId}`
}
