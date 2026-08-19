import assert from "node:assert/strict"
import { test } from "node:test"

import { isPixiSupported } from "../../src/frontend/components/output/webgpu/pixiBackgroundBridge.ts"

test("delegates explicit images to Pixi", () => {
    assert.equal(isPixiSupported("image"), true)
})

test("delegates videos to GPU composition", () => {
    assert.equal(isPixiSupported("video"), true)
})

test("delegates generic file media while keeping unknown types on managed surfaces", () => {
    assert.equal(isPixiSupported("media"), true)
    assert.equal(isPixiSupported(undefined), false)
    assert.equal(isPixiSupported(null), false)
})

test("keeps live and native presentation surfaces in the composed Electron window", () => {
    for (const type of ["camera", "screen", "website", "player", "ndi", "blackmagic", "pdf", "powerpoint"]) {
        assert.equal(isPixiSupported(type), false, `${type} should remain a managed presentation surface`)
    }
})
