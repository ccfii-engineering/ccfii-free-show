import assert from "node:assert/strict"
import { test } from "node:test"

import { describeRendererHealth } from "../../src/frontend/components/output/gpu/rendererHealth.ts"

test("describes the actual qualified GPU backend", () => {
    assert.equal(describeRendererHealth({ rendererState: "gpu-active", backend: "webgpu" }), "GPU renderer: WebGPU active")
    assert.equal(describeRendererHealth({ rendererState: "gpu-active", backend: "webgl" }), "GPU renderer: WebGL compatibility active")
})

test("makes legacy session fallback explicit", () => {
    assert.equal(describeRendererHealth({ rendererState: "legacy-fallback", reason: "gpu_initialization_failed" }), "GPU renderer: Legacy fallback active — gpu initialization failed")
})

test("distinguishes an operator opt-out from automatic fallback", () => {
    assert.equal(describeRendererHealth(undefined, true), "GPU renderer: Explicit legacy opt-out")
})

test("does not claim an active renderer before status is known", () => {
    assert.equal(describeRendererHealth(undefined), "GPU renderer: Waiting for output")
})
