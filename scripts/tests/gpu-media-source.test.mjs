import assert from "node:assert/strict"
import { test } from "node:test"

import { isVideoSource } from "../../src/frontend/components/output/webgpu/layers/mediaSource.ts"

test("explicit extensionless and blob videos remain on the GPU video path", () => {
    assert.equal(isVideoSource("blob:renderer-media", "video"), true)
    assert.equal(isVideoSource("https://example.test/background", "video"), true)
})

test("video extensions ignore URL query strings and fragments", () => {
    assert.equal(isVideoSource("https://example.test/background.mp4?token=abc#cue", "media"), true)
})

test("generic image media does not get routed through a video element", () => {
    assert.equal(isVideoSource("/tmp/background.png", "media"), false)
})
