import assert from "node:assert/strict"
import { test } from "node:test"
import { hasStageVideoItems, syncEventTargetListeners } from "../../src/frontend/utils/runtimeGuards.ts"

class FakeTarget {
    constructor() {
        this.added = []
        this.removed = []
    }

    addEventListener(name, handler) {
        this.added.push([name, handler])
    }

    removeEventListener(name, handler) {
        this.removed.push([name, handler])
    }
}

test("hasStageVideoItems detects video entries only", () => {
    assert.equal(hasStageVideoItems({ title: {}, current_video: {} }), true)
    assert.equal(hasStageVideoItems({ title: {}, timer: {} }), false)
    assert.equal(hasStageVideoItems(undefined), false)
})

test("syncEventTargetListeners attaches to a new target once", () => {
    const target = new FakeTarget()
    const listeners = { "dom-ready": () => {}, "did-finish-load": () => {} }

    const attached = syncEventTargetListeners(null, target, listeners)

    assert.equal(attached, target)
    assert.deepEqual(
        target.added.map(([name]) => name),
        ["dom-ready", "did-finish-load"]
    )
    assert.deepEqual(target.removed, [])
})

test("syncEventTargetListeners removes old listeners before switching targets", () => {
    const oldTarget = new FakeTarget()
    const newTarget = new FakeTarget()
    const listeners = { "dom-ready": () => {}, "did-navigate": () => {} }

    syncEventTargetListeners(null, oldTarget, listeners)
    const attached = syncEventTargetListeners(oldTarget, newTarget, listeners)

    assert.equal(attached, newTarget)
    assert.deepEqual(
        oldTarget.removed.map(([name]) => name),
        ["dom-ready", "did-navigate"]
    )
    assert.deepEqual(
        newTarget.added.map(([name]) => name),
        ["dom-ready", "did-navigate"]
    )
})

test("syncEventTargetListeners is a no-op when target is unchanged", () => {
    const target = new FakeTarget()
    const listeners = { "dom-ready": () => {} }

    syncEventTargetListeners(null, target, listeners)
    target.added = []
    target.removed = []

    const attached = syncEventTargetListeners(target, target, listeners)

    assert.equal(attached, target)
    assert.deepEqual(target.added, [])
    assert.deepEqual(target.removed, [])
})
