import assert from "node:assert/strict"
import { test } from "node:test"
import { getToggledVideoLoop, isVideoLooping } from "../../src/frontend/utils/videoLoopState.ts"

test("missing video loop value is treated as not looping", () => {
    assert.equal(isVideoLooping({}), false)
})

test("toggle turns a missing video loop value on", () => {
    assert.equal(getToggledVideoLoop({}), true)
})

test("explicit video loop values are preserved when read and inverted when toggled", () => {
    assert.equal(isVideoLooping({ loop: true }), true)
    assert.equal(isVideoLooping({ loop: false }), false)
    assert.equal(getToggledVideoLoop({ loop: true }), false)
    assert.equal(getToggledVideoLoop({ loop: false }), true)
})
