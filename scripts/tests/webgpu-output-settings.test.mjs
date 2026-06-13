import assert from "node:assert/strict"
import { test } from "node:test"
import { shouldUseWebGPU } from "../../src/frontend/components/output/webgpu/useWebGPUDecision.ts"

test("global off → never use webgpu", () => {
    assert.equal(shouldUseWebGPU({ special: { useWebGPUOutput: false }, output: { useWebGPU: true } }), false)
})

test("global on, per-output undefined → use webgpu", () => {
    assert.equal(shouldUseWebGPU({ special: { useWebGPUOutput: true }, output: {} }), true)
})

test("global on, per-output false → do not use webgpu", () => {
    assert.equal(shouldUseWebGPU({ special: { useWebGPUOutput: true }, output: { useWebGPU: false } }), false)
})

test("global on, per-output true → use webgpu", () => {
    assert.equal(shouldUseWebGPU({ special: { useWebGPUOutput: true }, output: { useWebGPU: true } }), true)
})

test("global undefined → default off for safety", () => {
    assert.equal(shouldUseWebGPU({ special: {}, output: {} }), false)
})

test("stage output → never use webgpu regardless of flags", () => {
    assert.equal(shouldUseWebGPU({ special: { useWebGPUOutput: true }, output: { stageOutput: "abc" } }), false)
})

test("video background → use DOM output to avoid WebGPU video compositing", () => {
    assert.equal(shouldUseWebGPU({ special: { useWebGPUOutput: true }, output: { out: { background: { type: "video", path: "/tmp/loop.mp4" } } } }), false)
})

test("video path without explicit type → use DOM output", () => {
    assert.equal(shouldUseWebGPU({ special: { useWebGPUOutput: true }, output: { out: { background: { path: "/tmp/loop.mov" } } } }), false)
})

test("image background → still use webgpu when enabled", () => {
    assert.equal(shouldUseWebGPU({ special: { useWebGPUOutput: true }, output: { out: { background: { type: "image", path: "/tmp/background.png" } } } }), true)
})

test("null-safe for missing special/output", () => {
    assert.equal(shouldUseWebGPU({ special: null, output: null }), false)
})
