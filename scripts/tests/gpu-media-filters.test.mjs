import test from "node:test"
import assert from "node:assert/strict"

import { parseCSSMediaFilters } from "../../src/frontend/components/output/webgpu/layers/mediaFilters.ts"

test("parses chained CSS media filters into GPU filter operations", () => {
    assert.deepEqual(parseCSSMediaFilters("brightness(70%) contrast(1.2) saturate(80%) hue-rotate(45deg) blur(6px)"), [
        { name: "brightness", value: 0.7 },
        { name: "contrast", value: 1.2 },
        { name: "saturate", value: 0.8 },
        { name: "hue-rotate", value: 45 },
        { name: "blur", value: 6 }
    ])
})

test("ignores unsupported and malformed filter values safely", () => {
    assert.deepEqual(parseCSSMediaFilters("drop-shadow(1px 1px black) brightness(nope) none"), [])
})
