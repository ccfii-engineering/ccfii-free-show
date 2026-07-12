import assert from "node:assert/strict"
import { test } from "node:test"

import { createLatestRequest } from "../../src/frontend/utils/latestRequest.ts"

test("a clear invalidates an earlier asynchronous render request", async () => {
    const requests = createLatestRequest()
    const pendingRender = requests.start()

    requests.invalidate()

    assert.equal(pendingRender.isCurrent(), false)
})
