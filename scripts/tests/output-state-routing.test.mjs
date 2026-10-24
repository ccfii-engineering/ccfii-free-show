import assert from "node:assert/strict"
import { test } from "node:test"

import { OutputStateRouting } from "../../src/electron/output/OutputStateRouting.ts"

test("renderer payload cannot impersonate another output", () => {
    const harness = createRoutingHarness()

    harness.receive(10, { channel: "OUTPUT_STATE_READY", data: { outputId: "two", sessionId: "s", protocolVersion: 1 } })

    assert.equal(harness.calls.ready.length, 0)
    assert.equal(harness.rejections[0].reason, "sender_output_mismatch")
})

test("only the registered main renderer can publish authoritative snapshots", () => {
    const harness = createRoutingHarness()
    const snapshot = { topic: "styles" }

    harness.receive(99, { channel: "OUTPUT_STATE_PUBLISH", data: snapshot })
    harness.receive(1, { channel: "OUTPUT_STATE_PUBLISH", data: snapshot })

    assert.deepEqual(harness.calls.publish, [snapshot])
    assert.equal(harness.rejections[0].reason, "sender_main_mismatch")
})

test("applied and rendered observations use the authenticated output identity", () => {
    const harness = createRoutingHarness()
    const applied = { outputId: "one", sessionId: "s", topic: "styles" }
    const rendered = { ...applied, status: "rendered" }

    harness.receive(10, { channel: "OUTPUT_STATE_APPLIED", data: applied })
    harness.receive(10, { channel: "OUTPUT_STATE_RENDERED", data: rendered })

    assert.deepEqual(harness.calls.applied, [[applied, "one"]])
    assert.deepEqual(harness.calls.rendered, [[rendered, "one"]])
})

test("unregistered renderer state messages are rejected", () => {
    const harness = createRoutingHarness()

    harness.receive(50, { channel: "OUTPUT_STATE_READY", data: { outputId: "one", sessionId: "s", protocolVersion: 1 } })

    assert.equal(harness.calls.ready.length, 0)
    assert.equal(harness.rejections[0].reason, "unregistered_sender")
})

function createRoutingHarness() {
    const calls = { publish: [], ready: [], applied: [], rendered: [], rejected: [] }
    const rejections = []
    const routing = new OutputStateRouting({
        broker: {
            publish: (data) => calls.publish.push(data),
            ready: (...args) => calls.ready.push(args),
            applied: (...args) => calls.applied.push(args),
            rendered: (...args) => calls.rendered.push(args),
            rejected: (...args) => calls.rejected.push(args)
        },
        getMainWebContentsId: () => 1,
        resolveOutputId: (webContentsId) => (webContentsId === 10 ? "one" : null),
        reject: (rejection) => rejections.push(rejection)
    })

    return { calls, rejections, receive: (senderId, message) => routing.receive(senderId, message) }
}
