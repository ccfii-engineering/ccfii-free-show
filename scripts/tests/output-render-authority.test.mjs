import test from "node:test"
import assert from "node:assert/strict"

import { OutputRenderAuthorityTracker } from "../../src/frontend/outputState/OutputRenderAuthorityTracker.ts"

test("publishes a new output revision before reactive store work can observe it", async () => {
    const tracker = new OutputRenderAuthorityTracker("session-a")
    let observedRevision = 0

    const rollback = tracker.beginRevision(7)
    await Promise.resolve().then(() => {
        observedRevision = tracker.current().revision
    })

    assert.equal(observedRevision, 7)
    assert.equal(tracker.current().sessionId, "session-a")
    rollback.commit()
})

test("failed application rolls back only while the failed revision is still current", () => {
    const tracker = new OutputRenderAuthorityTracker("session-a")
    const failed = tracker.beginRevision(3)
    tracker.beginRevision(4).commit()

    failed.rollback()

    assert.equal(tracker.current().revision, 4)
})
