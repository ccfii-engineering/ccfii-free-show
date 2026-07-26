import assert from "node:assert/strict"
import { test } from "node:test"

import { createOutputTopicSnapshot, hashOutputStatePayload } from "../../src/common/outputState/snapshot.ts"
import { createOutputStatePublisher } from "../../src/frontend/outputState/OutputStatePublisher.ts"

const shared = { kind: "shared" }

test("publisher revisions are monotonic per topic and scope", () => {
    const sent = []
    const publisher = createPublisher((snapshot) => sent.push(snapshot))

    publisher.publish("styles", shared, { default: { name: "One" } })
    publisher.publish("styles", shared, { default: { name: "Two" } })
    publisher.publish("output", { kind: "output", outputId: "a" }, output("a"))

    assert.deepEqual(
        sent.map((snapshot) => snapshot.revision),
        [1, 2, 1]
    )
})

test("output dependency vector uses observed published topic revisions", () => {
    const publisher = createPublisher(() => {})
    publisher.publish("styles", shared, { default: {} })
    publisher.publish("shows", shared, { show: {} })

    const snapshot = publisher.publishOutput("a", output("a"))

    assert.deepEqual(snapshot.dependencies, { "styles:shared": 1, "shows:shared": 1 })
})

test("unchanged sampled values do not invent a revision", () => {
    const sent = []
    const publisher = createPublisher((snapshot) => sent.push(snapshot))

    const first = publisher.publishIfChanged("styles", shared, { b: 2, a: 1 })
    const second = publisher.publishIfChanged("styles", shared, { a: 1, b: 2 })

    assert.equal(first.revision, 1)
    assert.equal(second, null)
    assert.equal(sent.length, 1)
    assert.equal(publisher.getRevision("styles", shared), 1)
})

test("forced publication resamples truth and advances its topic revision", () => {
    const sent = []
    const publisher = createPublisher((snapshot) => sent.push(snapshot))
    publisher.publishIfChanged("styles", shared, { default: {} })

    publisher.publish("styles", shared, { default: {} })

    assert.deepEqual(
        sent.map((snapshot) => snapshot.revision),
        [1, 2]
    )
})

test("output publication fails when an exact dependency was never observed", () => {
    const publisher = createPublisher(() => {})

    assert.throws(() => publisher.publishOutput("a", output("a")), /styles:shared/)
})

function createPublisher(sendSnapshot) {
    return createOutputStatePublisher(sendSnapshot, {
        createSnapshot: createOutputTopicSnapshot,
        fingerprint: hashOutputStatePayload,
        outputDependencies: ["styles", "shows"]
    })
}

function output(id) {
    return { id, enabled: true, active: true, name: id, color: "#fff", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, screen: null, out: {} }
}
