import assert from "node:assert/strict"
import { test } from "node:test"
import { shouldHoldVideoSeekCooldown } from "../../src/frontend/components/media/video/videoSyncCooldown.ts"

test("a paused video applies a meaningful seek during the cooldown", () => {
    assert.equal(shouldHoldVideoSeekCooldown(true, false, true, 0.4), false)
})

test("a paused video can wait through the cooldown when it is already aligned", () => {
    assert.equal(shouldHoldVideoSeekCooldown(true, false, true, 0.05), true)
})

test("a playing video remains on rate correction during the cooldown", () => {
    assert.equal(shouldHoldVideoSeekCooldown(true, false, false, 0.4), true)
})

test("explicit seeks still bypass the cooldown", () => {
    assert.equal(shouldHoldVideoSeekCooldown(true, true, false, 0.4), false)
})
