import test from "node:test"
import assert from "node:assert/strict"

import { applyFit } from "../../src/frontend/components/output/webgpu/layers/MediaLayer.ts"

function createSprite() {
    return {
        texture: { width: 1000, height: 500 },
        width: 0,
        height: 0,
        x: 0,
        y: 0
    }
}

test("fill fit stretches media to the full output frame", () => {
    const sprite = createSprite()

    applyFit(sprite, 1920, 1080, "fill", 1000, 500)

    assert.equal(sprite.width, 1920)
    assert.equal(sprite.height, 1080)
    assert.equal(sprite.x, 0)
    assert.equal(sprite.y, 0)
})
