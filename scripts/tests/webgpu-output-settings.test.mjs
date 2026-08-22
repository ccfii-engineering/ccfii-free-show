import assert from "node:assert/strict"
import { test } from "node:test"
import { shouldUseGPUOutput } from "../../src/frontend/components/output/webgpu/useWebGPUDecision.ts"

test("global off → never use webgpu", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: false }, output: { useWebGPU: true } }), false)
})

test("global on, per-output undefined → use webgpu", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: {} }), true)
})

test("global on, per-output false → do not use webgpu", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { useWebGPU: false } }), false)
})

test("global on, per-output true → use webgpu", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { useWebGPU: true } }), true)
})

test("missing global setting defaults to GPU mode for fresh and migrating installs", () => {
    assert.equal(shouldUseGPUOutput({ special: {}, output: {} }), true)
})

test("stage output → never use webgpu regardless of flags", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { stageOutput: "abc" } }), false)
})

test("no background stays in GPU renderer mode", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: {} } }), true)
})

test("video background uses the legacy renderer until GPU video lifecycle qualification passes", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: { background: { type: "video", path: "/tmp/loop.mp4" } } } }), false)
})

test("video path without explicit type uses the legacy renderer", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: { background: { path: "/tmp/loop.mov" } } } }), false)
})

test("player background uses the legacy renderer", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: { background: { type: "player", id: "video-id" } } } }), false)
})

test("qualified GPU video can be exercised explicitly", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true, gpuVideoLifecycleQualified: true }, output: { out: { background: { type: "video", path: "/tmp/loop.mp4" } } } }), true)
})

test("bounded loop semantics select the safe renderer even when qualified", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true, gpuVideoLifecycleQualified: true }, output: { out: { background: { type: "video", path: "/tmp/loop.mp4", startAt: 2 } } } }), false)
})

test("soft loop semantics select the safe renderer even when qualified", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true, gpuVideoLifecycleQualified: true }, output: { out: { background: { type: "video", path: "/tmp/loop.mp4", softLoop: 3 } } } }), false)
})

test("image background → still use webgpu when enabled", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: { background: { type: "image", path: "/tmp/background.png" } } } }), true)
})

test("color background → still use webgpu when enabled", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: { background: { type: "color", id: "#112233" } } } }), true)
})

test("null-safe for missing special/output", () => {
    assert.equal(shouldUseGPUOutput({ special: null, output: null }), true)
})

test("automatic session fallback atomically selects the legacy renderer", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: {}, sessionFallback: true }), false)
})
