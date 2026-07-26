import assert from "node:assert/strict"
import { test } from "node:test"

import { OutputStateBroker } from "../../src/electron/output/OutputStateBroker.ts"
import { createOutputTopicSnapshot, isValidOutputTopicSnapshot, outputStateKey } from "../../src/common/outputState/snapshot.ts"

const stylesRevision1 = createOutputTopicSnapshot("styles", { kind: "shared" }, 1, { default: { name: "Default" } })
const outputOneRevision1 = createOutputTopicSnapshot("output", { kind: "output", outputId: "one" }, 1, { enabled: true, active: true, name: "One", color: "#fff", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, screen: null, out: {} })
const outputOneRevision2 = createOutputTopicSnapshot("output", { kind: "output", outputId: "one" }, 2, { enabled: true, active: true, name: "One", color: "#fff", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, screen: null, out: { slide: { id: "show", index: 0 } } })

test("ready receives a manifest and every latest required topic", () => {
    const harness = createBrokerHarness()
    harness.broker.publish(stylesRevision1)
    harness.broker.publish(outputOneRevision1)
    harness.ready("session-a")

    assert.deepEqual(
        harness.sentTo("one").map((message) => message.channel),
        ["OUTPUT_STATE_MANIFEST", "OUTPUT_STATE_APPLY", "OUTPUT_STATE_APPLY"]
    )
    assert.deepEqual(
        harness.sentTo("one")[0].data.entries.map((entry) => outputStateKey(entry.topic, entry.scope)),
        ["styles:shared", "output:one"]
    )
})

test("ready requests exact missing authoritative topics", () => {
    const harness = createBrokerHarness()
    harness.broker.publish(outputOneRevision1)
    harness.ready("session-a")

    assert.deepEqual(harness.sentMain[0], { channel: "OUTPUT_STATE_NEEDED", data: { keys: [{ topic: "styles", scope: { kind: "shared" } }] } })
})

test("stale acknowledgements cannot satisfy the latest revision", () => {
    const harness = createBrokerHarness()
    harness.broker.publish(outputOneRevision1)
    harness.ready("session-a")
    harness.broker.publish(outputOneRevision2)
    harness.broker.applied(observation(outputOneRevision1, "session-a"), "one")

    assert.equal(harness.latestHealth().status, "syncing")
    harness.clock.advanceBy(500)
    assert.equal(harness.latestHealth().status, "retrying")
    assert.equal(harness.latestHealth().revision, 2)
})

test("a newer snapshot supersedes the older retry", () => {
    const harness = createBrokerHarness()
    harness.broker.publish(outputOneRevision1)
    harness.ready("session-a")
    harness.broker.publish(outputOneRevision2)
    harness.clock.advanceBy(500)

    const appliedRevisions = harness
        .sentTo("one")
        .filter((message) => message.channel === "OUTPUT_STATE_APPLY" && message.data.snapshot.topic === "output")
        .map((message) => message.data.snapshot.revision)
    assert.deepEqual(appliedRevisions, [1, 2, 2])
})

test("three missed acknowledgements recreate once and open the circuit", () => {
    const harness = createBrokerHarness()
    harness.broker.publish(stylesRevision1)
    harness.broker.publish(outputOneRevision1)
    harness.ready("session-a")
    harness.clock.advanceBy(3500)

    assert.deepEqual(harness.recreated, ["one"])
    assert.equal(harness.latestHealth().status, "recovering")

    harness.ready("session-b")
    harness.clock.advanceBy(3500)

    assert.deepEqual(harness.recreated, ["one"])
    assert.equal(harness.latestHealth().status, "unhealthy")
})

test("matching acknowledgements make the session healthy", () => {
    const harness = createBrokerHarness()
    harness.broker.publish(stylesRevision1)
    harness.broker.publish(outputOneRevision1)
    harness.ready("session-a")
    harness.broker.applied(observation(stylesRevision1, "session-a"), "one")
    harness.broker.applied(observation(outputOneRevision1, "session-a"), "one")

    assert.equal(harness.latestHealth().status, "healthy")
    harness.clock.advanceBy(5000)
    assert.deepEqual(harness.recreated, [])
})

function observation(snapshot, sessionId) {
    return { outputId: "one", sessionId, topic: snapshot.topic, scope: snapshot.scope, revision: snapshot.revision, contentHash: snapshot.contentHash }
}

function createBrokerHarness() {
    const clock = new FakeClock()
    const sent = []
    const sentMain = []
    const recreated = []
    const broker = new OutputStateBroker({
        requiredSharedTopics: ["styles"],
        validateSnapshot: isValidOutputTopicSnapshot,
        snapshotKey: outputStateKey,
        scheduler: clock,
        transport: {
            sendToOutput: (outputId, message) => sent.push({ outputId, message }),
            sendToMain: (message) => sentMain.push(message),
            recreateOutput: (outputId) => recreated.push(outputId)
        }
    })

    return {
        broker,
        clock,
        sentMain,
        recreated,
        ready: (sessionId) => broker.ready({ outputId: "one", sessionId, protocolVersion: 1 }, "one"),
        sentTo: (outputId) => sent.filter((entry) => entry.outputId === outputId).map((entry) => entry.message),
        latestHealth: () => sentMain.filter((message) => message.channel === "OUTPUT_STATE_HEALTH").at(-1).data
    }
}

class FakeClock {
    currentTime = 0
    nextId = 1
    timers = new Map()

    now = () => this.currentTime

    setTimeout = (callback, delay) => {
        const id = this.nextId++
        this.timers.set(id, { at: this.currentTime + delay, callback })
        return id
    }

    clearTimeout = (id) => this.timers.delete(id)

    advanceBy(duration) {
        const target = this.currentTime + duration
        while (true) {
            const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
            if (!due) break
            this.timers.delete(due[0])
            this.currentTime = due[1].at
            due[1].callback()
        }
        this.currentTime = target
    }
}
