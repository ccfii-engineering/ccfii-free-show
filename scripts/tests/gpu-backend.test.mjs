import assert from "node:assert/strict"
import { test } from "node:test"

import { hasRequiredWebGPUPlatform, initializeGPUBackend, rendererTypeMatchesBackend } from "../../src/frontend/components/output/gpu/GPUBackend.ts"
import { presentProbeFrame } from "../../src/frontend/components/output/gpu/PixiPresentationProbe.ts"

test("does not misreport Pixi's silent backend compatibility fallback", () => {
    assert.equal(rendererTypeMatchesBackend(1, "webgpu"), false)
    assert.equal(rendererTypeMatchesBackend(2, "webgpu"), true)
    assert.equal(rendererTypeMatchesBackend(1, "webgl"), true)
})

test("WebGPU qualification requires browser adapter and usage constants", () => {
    assert.equal(hasRequiredWebGPUPlatform({ navigator: { gpu: {} }, GPUTextureUsage: {} }), true)
    assert.equal(hasRequiredWebGPUPlatform({ navigator: { gpu: {} } }), false)
    assert.equal(hasRequiredWebGPUPlatform({ GPUTextureUsage: {} }), false)
})

test("accepts WebGPU only after the presentation probe succeeds", async () => {
    const created = []
    const result = await initializeGPUBackend({
        create: async (backend) => {
            created.push(backend)
            return { backend }
        },
        probe: async () => true,
        destroy: () => {}
    })

    assert.equal(result.backend, "webgpu")
    assert.deepEqual(created, ["webgpu"])
})

test("destroys a failed WebGPU application before creating WebGL", async () => {
    const events = []
    const result = await initializeGPUBackend({
        create: async (backend) => {
            events.push(`create:${backend}`)
            return { backend }
        },
        probe: async (app) => app.backend === "webgl",
        destroy: async (app) => events.push(`destroy:${app.backend}`)
    })

    assert.equal(result.backend, "webgl")
    assert.deepEqual(events, ["create:webgpu", "destroy:webgpu", "create:webgl"])
})

test("destroys every failed backend and reports terminal initialization failure", async () => {
    const destroyed = []

    await assert.rejects(
        initializeGPUBackend({
            create: async (backend) => ({ backend }),
            probe: async () => false,
            destroy: async (app) => destroyed.push(app.backend)
        }),
        /GPU backend initialization failed/
    )

    assert.deepEqual(destroyed, ["webgpu", "webgl"])
})

test("times out a backend that never presents a probe frame", async () => {
    const destroyed = []

    await assert.rejects(
        initializeGPUBackend({
            create: async (backend) => ({ backend }),
            probe: async () => new Promise(() => {}),
            destroy: async (app) => destroyed.push(app.backend),
            timeoutMs: 5
        }),
        /GPU backend initialization failed/
    )

    assert.deepEqual(destroyed, ["webgpu", "webgl"])
})

test("destroys an application that finishes creating after its deadline", async () => {
    const destroyed = []

    await assert.rejects(
        initializeGPUBackend({
            create: (backend) => (backend === "webgpu" ? new Promise((resolve) => setTimeout(() => resolve({ backend }), 12)) : new Promise(() => {})),
            probe: async () => true,
            destroy: async (app) => destroyed.push(app.backend),
            timeoutMs: 8
        }),
        /GPU backend initialization failed/
    )
    await new Promise((resolve) => setTimeout(resolve, 15))

    assert.deepEqual(destroyed, ["webgpu"])
})

test("cleanup failure cannot prevent the compatibility backend attempt", async () => {
    const created = []
    const result = await initializeGPUBackend({
        create: async (backend) => {
            created.push(backend)
            return { backend }
        },
        probe: async (app) => app.backend === "webgl",
        destroy: async () => {
            throw new Error("driver cleanup failed")
        }
    })

    assert.equal(result.backend, "webgl")
    assert.deepEqual(created, ["webgpu", "webgl"])
})

test("qualification extracts the composed stage rather than the isolated probe object", async () => {
    const stage = {
        children: [],
        addChild(child) {
            this.children.push(child)
        },
        removeChild(child) {
            this.children = this.children.filter((entry) => entry !== child)
        }
    }
    let extractedTarget = null
    class Graphics {
        rect() {
            return this
        }
        fill() {
            return this
        }
        destroy() {}
    }
    const app = {
        stage,
        renderer: {
            render() {},
            extract: {
                pixels: async ({ target }) => {
                    extractedTarget = target
                    return { pixels: [255, 0, 255, 255] }
                }
            }
        }
    }

    assert.equal(await presentProbeFrame({ Graphics }, app), true)
    assert.equal(extractedTarget, stage)
})
