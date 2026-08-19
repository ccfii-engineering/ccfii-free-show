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

test("video background stays in GPU renderer mode", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: { background: { type: "video", path: "/tmp/loop.mp4" } } } }), true)
})

test("video path without explicit type stays in GPU renderer mode", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: { background: { path: "/tmp/loop.mov" } } } }), true)
})

test("image background → still use webgpu when enabled", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: { out: { background: { type: "image", path: "/tmp/background.png" } } } }), true)
})

test("null-safe for missing special/output", () => {
    assert.equal(shouldUseGPUOutput({ special: null, output: null }), true)
})

test("automatic session fallback atomically selects the legacy renderer", () => {
    assert.equal(shouldUseGPUOutput({ special: { useWebGPUOutput: true }, output: {}, sessionFallback: true }), false)
})
