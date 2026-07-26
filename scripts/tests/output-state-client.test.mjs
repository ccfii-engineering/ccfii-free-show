import assert from "node:assert/strict"
import { test } from "node:test"

import { createOutputTopicSnapshot, isValidOutputTopicSnapshot, outputStateKey } from "../../src/common/outputState/snapshot.ts"
import { createDependencyGate } from "../../src/common/outputState/dependencyGate.ts"
import { OutputStateClient } from "../../src/frontend/outputState/OutputStateClient.ts"

const shared = { kind: "shared" }
const outputScope = { kind: "output", outputId: "one" }
const stylesRevision1 = createOutputTopicSnapshot("styles", shared, 1, { default: { name: "One" } })
const stylesRevision2 = createOutputTopicSnapshot("styles", shared, 2, { default: { name: "Two" } })
const stylesRevision3 = createOutputTopicSnapshot("styles", shared, 3, { default: { name: "Three" } })
const outputRevision2 = createOutputTopicSnapshot("output", outputScope, 2, output(), { "styles:shared": 3 })

test("output waits for exact dependency revisions", () => {
    const gate = createDependencyGate()
    gate.receive(outputRevision2)
    assert.equal(gate.takeReady(), null)

    gate.markApplied("styles:shared", 3)

    assert.equal(gate.takeReady().revision, 2)
})

test("a newer dependency does not make an older output dependency exact", () => {
    const gate = createDependencyGate()
    gate.receive(outputRevision2)
    gate.markApplied("styles:shared", 4)

    assert.equal(gate.takeReady(), null)
})

test("older topic snapshots are rejected without mutating the target", async () => {
    const harness = createClientHarness()
    await harness.apply(stylesRevision2)
    await harness.apply(stylesRevision1)

    assert.deepEqual(harness.appliedPayloads, [stylesRevision2.payload])
    assert.equal(harness.messages.at(-1).channel, "OUTPUT_STATE_REJECTED")
    assert.equal(harness.messages.at(-1).data.reason, "stale_revision")
})

test("duplicate exact snapshots are acknowledged idempotently", async () => {
    const harness = createClientHarness()
    await harness.apply(stylesRevision1)
    await harness.apply(stylesRevision1)

    assert.equal(harness.appliedPayloads.length, 1)
    assert.deepEqual(
        harness.messages.map(({ channel }) => channel),
        ["OUTPUT_STATE_APPLIED", "OUTPUT_STATE_APPLIED"]
    )
})

test("dependency arrival releases a buffered output and acknowledges both", async () => {
    const harness = createClientHarness()
    await harness.apply(outputRevision2)
    assert.equal(harness.appliedPayloads.length, 0)

    await harness.apply(stylesRevision3)

    assert.deepEqual(harness.appliedTopics, ["styles", "output"])
    assert.deepEqual(
        harness.messages.map(({ channel }) => channel),
        ["OUTPUT_STATE_APPLIED", "OUTPUT_STATE_APPLIED"]
    )
})

test("wrong output and session envelopes never mutate state", async () => {
    const harness = createClientHarness()

    await harness.client.receiveApply({ outputId: "two", sessionId: "session-a", snapshot: stylesRevision1 })
    await harness.client.receiveApply({ outputId: "one", sessionId: "old-session", snapshot: stylesRevision1 })

    assert.equal(harness.appliedPayloads.length, 0)
    assert.deepEqual(
        harness.messages.map(({ data }) => data.reason),
        ["wrong_output", "wrong_session"]
    )
})

function createClientHarness() {
    const messages = []
    const appliedPayloads = []
    const appliedTopics = []
    const client = new OutputStateClient({
        outputId: "one",
        sessionId: "session-a",
        protocolVersion: 1,
        validateSnapshot: isValidOutputTopicSnapshot,
        snapshotKey: outputStateKey,
        dependencyGate: createDependencyGate(),
        applyTopic: async (snapshot) => {
            appliedTopics.push(snapshot.topic)
            appliedPayloads.push(snapshot.payload)
        },
        afterApply: async () => {},
        send: (message) => messages.push(message)
    })

    return {
        client,
        messages,
        appliedPayloads,
        appliedTopics,
        apply: (snapshot) => client.receiveApply({ outputId: "one", sessionId: "session-a", snapshot })
    }
}

function output() {
    return { enabled: true, active: true, name: "One", color: "#fff", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, screen: null, out: {} }
}
