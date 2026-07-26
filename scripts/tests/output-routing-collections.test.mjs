import assert from "node:assert/strict"
import { test } from "node:test"

import { removeRoutingTarget } from "../../src/electron/output/routingTargets.ts"

test("removing an unknown routing target never removes a valid target", () => {
    const targets = ["one", "two"]
    assert.equal(removeRoutingTarget(targets, "missing"), false)
    assert.deepEqual(targets, ["one", "two"])
})

test("removing a routing target removes only that target", () => {
    const targets = ["one", "two"]
    assert.equal(removeRoutingTarget(targets, "one"), true)
    assert.deepEqual(targets, ["two"])
})
