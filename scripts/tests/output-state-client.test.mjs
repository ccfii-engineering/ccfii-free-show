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
const stylesRevision4 = createOutputTopicSnapshot("styles", shared, 4, { default: { name: "Four" } })
const languageRevision1 = createOutputTopicSnapshot("language", shared, 1, "en")
const outputRevision2 = createOutputTopicSnapshot("output", outputScope, 2, output(), { "styles:shared": 3 })
const outputRevision3 = createOutputTopicSnapshot("output", outputScope, 3, output(), { "styles:shared": 4 })

test("output waits for exact dependency revisions", () => {
    const gate = createDependencyGate()
    gate.receive(outputRevision2)

    assert.deepEqual(gate.takeReady(), { snapshot: null, superseded: [] })

    gate.receive(stylesRevision3)
    assert.equal(gate.takeReady().snapshot.revision, 3)
    gate.markApplied("styles:shared", 3)

    assert.equal(gate.takeReady().snapshot.revision, 2)
})

test("a newer dependency supersedes an impossible exact dependency", () => {
    const gate = createDependencyGate()
    gate.receive(outputRevision2)
    gate.receive(stylesRevision4)

    const result = gate.takeReady()

    assert.deepEqual(result.superseded, [outputRevision2])
    assert.equal(result.snapshot, stylesRevision4)
    gate.markApplied("styles:shared", 4)
    assert.deepEqual(gate.takeReady(), { snapshot: null, superseded: [] })
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

test("the client-wide pump serializes topics and suppresses obsolete completion", async () => {
    const firstTick = deferred()
    let tickCount = 0
    const harness = createClientHarness({
        afterApply: () => {
            tickCount += 1
            return tickCount === 1 ? firstTick.promise : Promise.resolve()
        }
    })

    const first = harness.apply(stylesRevision1)
    const newerSameTopic = harness.apply(stylesRevision2)
    const otherTopic = harness.apply(languageRevision1)
    const duplicateInFlight = harness.apply(stylesRevision1)

    assert.deepEqual(harness.appliedTopics, ["styles"])
    assert.equal(
        harness.messages.some(({ channel, data }) => channel === "OUTPUT_STATE_APPLIED" && data.revision === 1),
        false
    )

    firstTick.resolve()
    await Promise.all([first, newerSameTopic, otherTopic, duplicateInFlight])

    assert.deepEqual(harness.appliedTopics, ["styles", "styles", "language"])
    assert.deepEqual(
        harness.messages.filter(({ channel }) => channel === "OUTPUT_STATE_APPLIED").map(({ data }) => [data.topic, data.revision]),
        [
            ["styles", 2],
            ["language", 1]
        ]
    )
})

test("dependency supersession during an output tick requests a fresh compatible snapshot", async () => {
    const outputTick = deferred()
    let tickCount = 0
    const harness = createClientHarness({
        afterApply: () => {
            tickCount += 1
            return tickCount === 2 ? outputTick.promise : Promise.resolve()
        }
    })

    await harness.apply(stylesRevision3)
    const obsoleteOutput = harness.apply(outputRevision2)
    assert.deepEqual(harness.appliedTopics, ["styles", "output"])
    const styles4 = harness.apply(stylesRevision4)
    assert.deepEqual(harness.appliedTopics, ["styles", "output"])

    outputTick.resolve()
    await Promise.all([obsoleteOutput, styles4])

    assert.deepEqual(harness.appliedTopics, ["styles", "output", "styles"])
    assert.equal(
        harness.messages.some(({ channel, data }) => channel === "OUTPUT_STATE_REJECTED" && data.reason === "missing_dependency" && data.revision === 2),
        true
    )
    assert.equal(
        harness.messages.some(({ channel, data }) => channel === "OUTPUT_STATE_APPLIED" && data.topic === "output" && data.revision === 2),
        false
    )

    await harness.apply(outputRevision3)

    assert.deepEqual(harness.appliedTopics, ["styles", "output", "styles", "output"])
    assert.deepEqual(
        harness.messages.filter(({ channel }) => channel === "OUTPUT_STATE_APPLIED").map(({ data }) => [data.topic, data.revision]),
        [
            ["styles", 3],
            ["styles", 4],
            ["output", 3]
        ]
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

test("same-turn dependency arrival wakes a blocked apply pump", async () => {
    const harness = createClientHarness()

    await Promise.all([harness.apply(outputRevision2), harness.apply(stylesRevision3)])

    assert.deepEqual(harness.appliedTopics, ["styles", "output"])
    assert.deepEqual(
        harness.messages.filter(({ channel }) => channel === "OUTPUT_STATE_APPLIED").map(({ data }) => [data.topic, data.revision]),
        [
            ["styles", 3],
            ["output", 2]
        ]
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

test("a cleared output reports terminal rendering after its applied acknowledgement", async () => {
    const harness = createClientHarness()
    await harness.apply(stylesRevision3)
    const cleared = createOutputTopicSnapshot("output", outputScope, 1, { ...output(), out: { presentationMode: "cleared", background: null, slide: null, overlays: [], effects: [], transition: null } }, { "styles:shared": 3 })

    await harness.apply(cleared)

    assert.deepEqual(
        harness.messages.slice(-2).map(({ channel }) => channel),
        ["OUTPUT_STATE_APPLIED", "OUTPUT_STATE_RENDERED"]
    )
})

function createClientHarness(options = {}) {
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
        afterApply: options.afterApply || (async () => {}),
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

function deferred() {
    let resolve
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise
    })
    return { promise, resolve }
}
