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

test("null-safe for missing special/output", () => {
    assert.equal(shouldUseWebGPU({ special: null, output: null }), false)
})
