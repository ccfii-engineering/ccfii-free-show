import { tick } from "svelte"
import { createDependencyGate } from "../../common/outputState/dependencyGate"
import { OUTPUT_STATE_PROTOCOL_VERSION, isValidOutputTopicSnapshot, outputStateKey } from "../../common/outputState/snapshot"
import { OUTPUT } from "../../types/Channels"
import type { OutputStateApply, OutputStateManifest } from "../../types/OutputState"
import { receive, send } from "../utils/request"
import { applyOutputTopicSnapshot } from "./applyTopic"
import { OutputStateClient } from "./OutputStateClient"

let client: OutputStateClient | null = null

export function startOutputStateClient(outputId: string): void {
    if (client) return

    client = new OutputStateClient({
        outputId,
        sessionId: createSessionId(),
        protocolVersion: OUTPUT_STATE_PROTOCOL_VERSION,
        validateSnapshot: isValidOutputTopicSnapshot,
        snapshotKey: outputStateKey,
        dependencyGate: createDependencyGate(),
        applyTopic: (snapshot) => applyOutputTopicSnapshot(snapshot, outputId),
        afterApply: tick,
        send: ({ channel, data }) => send(OUTPUT, [channel], data)
    })

    receive(
        OUTPUT,
        {
            OUTPUT_STATE_MANIFEST: (manifest: OutputStateManifest) => client?.receiveManifest(manifest),
            OUTPUT_STATE_APPLY: (apply: OutputStateApply) => client?.receiveApply(apply)
        },
        "output-state-client"
    )
    client.start()
}

function createSessionId(): string {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
