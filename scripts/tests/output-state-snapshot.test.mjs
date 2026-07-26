import assert from "node:assert/strict"
import { test } from "node:test"

import { createOutputTopicSnapshot, hashOutputStatePayload, isOutputTopicSnapshot, isValidOutputTopicSnapshot, outputStateKey } from "../../src/common/outputState/snapshot.ts"

test("equivalent payload key order has one canonical hash", () => {
    assert.equal(hashOutputStatePayload({ b: 2, a: 1 }), hashOutputStatePayload({ a: 1, b: 2 }))
})

test("canonical hash preserves array order", () => {
    assert.notEqual(hashOutputStatePayload(["first", "second"]), hashOutputStatePayload(["second", "first"]))
})

test("canonical hash rejects cyclic values", () => {
    const cyclic = {}
    cyclic.self = cyclic

    assert.throws(() => hashOutputStatePayload(cyclic), /cyclic/i)
})

test("snapshot validation rejects malformed scope and revisions", () => {
    assert.equal(isOutputTopicSnapshot({ protocolVersion: 1, topic: "output", scope: { kind: "output" }, revision: 0, contentHash: "x", payload: {} }), false)
})

test("snapshot validation rejects a mismatched content hash", () => {
    const snapshot = createOutputTopicSnapshot("styles", { kind: "shared" }, 1, { default: { name: "Default" } })

    assert.equal(isValidOutputTopicSnapshot({ ...snapshot, payload: {} }), false)
})

test("snapshot identity includes topic, scope, revision, dependencies, and payload", () => {
    const first = createOutputTopicSnapshot("output", { kind: "output", outputId: "one" }, 1, { name: "Primary" }, { "styles:shared": 2 })
    const changedRevision = createOutputTopicSnapshot("output", { kind: "output", outputId: "one" }, 2, { name: "Primary" }, { "styles:shared": 2 })
    const changedDependency = createOutputTopicSnapshot("output", { kind: "output", outputId: "one" }, 1, { name: "Primary" }, { "styles:shared": 3 })

    assert.notEqual(first.contentHash, changedRevision.contentHash)
    assert.notEqual(first.contentHash, changedDependency.contentHash)
    assert.equal(isValidOutputTopicSnapshot(first), true)
})

test("topic keys are stable and output scoped", () => {
    assert.equal(outputStateKey("styles", { kind: "shared" }), "styles:shared")
    assert.equal(outputStateKey("output", { kind: "output", outputId: "one" }), "output:one")
})
