import assert from "node:assert/strict"
import { test } from "node:test"

import { RenderRevisionTracker } from "../../src/frontend/outputState/RenderRevisionTracker.ts"

test("rendered emits only after every required layer reaches a terminal state", () => {
    const tracker = new RenderRevisionTracker(1, ["styleBackground", "background", "slide"])
    tracker.completeFor(1, "styleBackground")
    tracker.completeFor(1, "background")
    assert.equal(tracker.result(), null)

    tracker.completeFor(1, "slide")

    assert.deepEqual(tracker.result(), { revision: 1, status: "rendered", failures: [] })
})

test("new revision invalidates terminal events from the old revision", () => {
    const tracker = new RenderRevisionTracker(1, ["background"])
    tracker.start(2, ["background"])
    tracker.completeFor(1, "background")

    assert.equal(tracker.result(), null)
})

test("typed layer failures are terminal without hiding the failure", () => {
    const tracker = new RenderRevisionTracker(4, ["background", "slide"])
    tracker.failFor(4, "background", "missing_media")
    tracker.completeFor(4, "slide")

    assert.deepEqual(tracker.result(), { revision: 4, status: "render_failed", failures: [{ layer: "background", reason: "missing_media" }] })
})

test("a revision with no visible layers is immediately rendered", () => {
    const tracker = new RenderRevisionTracker(5, [])
    assert.deepEqual(tracker.result(), { revision: 5, status: "rendered", failures: [] })
})
