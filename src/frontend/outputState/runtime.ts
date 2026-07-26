import { get, type Unsubscriber } from "svelte/store"
import { createOutputTopicSnapshot, hashOutputStatePayload } from "../../common/outputState/snapshot"
import { OUTPUT } from "../../types/Channels"
import type { Output } from "../../types/Output"
import type { OutputStateNeeded, OutputStateScope, OutputStateTopic } from "../../types/OutputState"
import { outputs, videosData, videosTime } from "../stores"
import { send } from "../utils/request"
import { createOutputStatePublisher, type OutputStatePublisher } from "./OutputStatePublisher"
import { getOutputStateTopicSource, OUTPUT_STATE_DEPENDENCY_TOPICS, OUTPUT_STATE_TOPIC_SOURCES } from "./topics"

let publisher: OutputStatePublisher | null = null
let unsubscribers: Unsubscriber[] = []

export function startOutputStatePublisher(): void {
    if (publisher) return

    publisher = createOutputStatePublisher((snapshot) => send(OUTPUT, ["OUTPUT_STATE_PUBLISH"], snapshot), {
        createSnapshot: createOutputTopicSnapshot,
        fingerprint: hashOutputStatePayload,
        outputDependencies: OUTPUT_STATE_DEPENDENCY_TOPICS
    })

    let initializingSharedTopics = true
    OUTPUT_STATE_TOPIC_SOURCES.forEach((source) => {
        unsubscribers.push(
            source.store.subscribe(() => {
                const changed = publishShared(source.topic, false)
                if (changed && !initializingSharedTopics) publishEveryOutput()
            })
        )
    })
    initializingSharedTopics = false
    unsubscribers.push(
        outputs.subscribe((currentOutputs) => {
            sampleAllSharedTopics()
            Object.entries(currentOutputs).forEach(([outputId, output]) => publishOutput(outputId, output))
        })
    )
    unsubscribers.push(videosData.subscribe(() => publishAllMediaControlBaselines(false)))
    unsubscribers.push(videosTime.subscribe(() => publishAllMediaControlBaselines(false)))
}

export function stopOutputStatePublisher(): void {
    unsubscribers.forEach((unsubscribe) => unsubscribe())
    unsubscribers = []
    publisher = null
}

export function publishNeededOutputState({ keys }: OutputStateNeeded): void {
    if (!publisher) startOutputStatePublisher()

    keys.forEach(({ topic, scope }) => {
        if (scope.kind === "shared") publishShared(topic, true)
        else if (topic === "output") {
            const output = get(outputs)[scope.outputId]
            if (output) {
                sampleAllSharedTopics()
                publishOutput(scope.outputId, output)
            }
        } else if (topic === "mediaControlBaseline") publishMediaControlBaseline(scope.outputId, true)
    })
}

function publishShared(topic: OutputStateTopic, force: boolean): boolean {
    const source = getOutputStateTopicSource(topic)
    if (!publisher || !source) return false

    const payload = source.read()
    if (force) {
        publisher.publish(source.topic, sharedScope, payload)
        return true
    }
    return !!publisher.publishIfChanged(source.topic, sharedScope, payload)
}

function sampleAllSharedTopics(): void {
    OUTPUT_STATE_TOPIC_SOURCES.forEach(({ topic }) => publishShared(topic, false))
}

function publishOutput(outputId: string, output: Output): void {
    if (!publisher) return
    const normalizedOutput = {
        ...output,
        id: output.id || outputId,
        out: { ...(output.out || {}), presentationMode: (output.out as any)?.presentationMode ?? "live" }
    } as Output
    publisher.publishOutput(outputId, normalizedOutput)
    publishMediaControlBaseline(outputId, false)
}

function publishEveryOutput(): void {
    const currentOutputs = get(outputs)
    Object.entries(currentOutputs).forEach(([outputId, output]) => publishOutput(outputId, output))
}

function publishAllMediaControlBaselines(force: boolean): void {
    Object.keys(get(outputs)).forEach((outputId) => publishMediaControlBaseline(outputId, force))
}

function publishMediaControlBaseline(outputId: string, force: boolean): void {
    if (!publisher) return
    const scope: OutputStateScope = { kind: "output", outputId }
    const payload = { videoData: get(videosData)[outputId] ?? null, videoTime: get(videosTime)[outputId] ?? null }
    if (force) publisher.publish("mediaControlBaseline", scope, payload)
    else publisher.publishIfChanged("mediaControlBaseline", scope, payload)
}

const sharedScope = { kind: "shared" } as const
