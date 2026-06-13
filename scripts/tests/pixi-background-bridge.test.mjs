import assert from "node:assert/strict"
import { test } from "node:test"

import { isPixiSupported } from "../../src/frontend/components/output/webgpu/pixiBackgroundBridge.ts"

test("delegates explicit images to Pixi", () => {
    assert.equal(isPixiSupported("image"), true)
})

test("keeps videos on the DOM renderer", () => {
    assert.equal(isPixiSupported("video"), false)
})

test("keeps ambiguous media on the DOM renderer", () => {
    assert.equal(isPixiSupported("media"), false)
    assert.equal(isPixiSupported(undefined), false)
    assert.equal(isPixiSupported(null), false)
})
