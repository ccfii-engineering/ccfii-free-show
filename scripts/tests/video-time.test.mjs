import assert from "node:assert/strict"
import { test } from "node:test"
import { isVideoTimeReset } from "../../src/frontend/components/output/videoTime.ts"

test("detects video time resets so loop restarts bypass throttling", () => {
    assert.equal(isVideoTimeReset(0, 19.8), true)
    assert.equal(isVideoTimeReset(19.6, 19.8), false)
    assert.equal(isVideoTimeReset(20, Number.NaN), false)
})
