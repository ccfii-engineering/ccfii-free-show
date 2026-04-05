import test from "node:test"
import assert from "node:assert/strict"

import { cancelAllTransitions, startTransition } from "../../src/frontend/components/output/webgpu/transitionManager.ts"

function createSprite({ x = 0, y = 0, width = 300, height = 200 } = {}) {
    return {
        visible: false,
        alpha: 0,
        x,
        y,
        width,
        height,
        rotation: 0,
        filters: [],
        parent: { width: 1920, height: 1080 },
        scale: {
            x: 1,
            y: 1,
            set(nextX, nextY) {
                this.x = nextX
                this.y = nextY
            }
        },
        pivot: {
            x: 0,
            y: 0,
            set(nextX, nextY) {
                this.x = nextX
                this.y = nextY
            }
        }
    }
}

test("completed fade transitions preserve an already-fitted sprite position", () => {
    const sprite = createSprite({ x: 205, y: 140 })
    sprite.scale.set(1.333, 1.333)

    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    const queuedFrames = []

    globalThis.requestAnimationFrame = (callback) => {
        queuedFrames.push(callback)
        return queuedFrames.length
    }
    globalThis.cancelAnimationFrame = () => {}

    try {
        const startTime = performance.now()

        startTransition("position-preserved", "fade", 10, "linear", null, sprite)

        assert.equal(queuedFrames.length, 1)

        const runFrame = queuedFrames.shift()
        runFrame(startTime + 20)

        assert.equal(sprite.x, 205)
        assert.equal(sprite.y, 140)
        assert.equal(sprite.scale.x, 1.333)
        assert.equal(sprite.scale.y, 1.333)
    } finally {
        cancelAllTransitions()
        globalThis.requestAnimationFrame = originalRequestAnimationFrame
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
})
