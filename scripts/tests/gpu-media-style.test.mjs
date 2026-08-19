import test from "node:test"
import assert from "node:assert/strict"

import { resolveGPUBackgroundStyle } from "../../src/frontend/components/output/gpu/GPUBackgroundStyle.ts"

test("GPU backgrounds inherit style defaults and preserve media-specific overrides", () => {
    const resolved = resolveGPUBackgroundStyle(
        {
            path: "/media/welcome.png",
            type: "image",
            filter: "brightness(70%)",
            flipped: true,
            cropping: { top: 5, right: 10, bottom: 15, left: 20 }
        },
        { fit: "cover", blurAmount: 9, blurOpacity: 0.4, volume: 75 }
    )

    assert.equal(resolved.path, "/media/welcome.png")
    assert.equal(resolved.fit, "cover")
    assert.deepEqual(resolved.fitOptions, { blurAmount: 9, blurOpacity: 0.4 })
    assert.equal(resolved.filter, "brightness(70%)")
    assert.equal(resolved.flipped, true)
    assert.deepEqual(resolved.cropping, { top: 5, right: 10, bottom: 15, left: 20 })
})

test("explicit false and zero values remain authoritative", () => {
    const resolved = resolveGPUBackgroundStyle({ flipped: false, loop: false, softLoop: 0, startAt: 0 }, { fit: "contain" })

    assert.equal(resolved.flipped, false)
    assert.equal(resolved.loop, false)
    assert.equal(resolved.softLoop, 0)
    assert.equal(resolved.startAt, 0)
})
