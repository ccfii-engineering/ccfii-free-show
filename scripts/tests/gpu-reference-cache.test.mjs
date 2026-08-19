import assert from "node:assert/strict"
import { test } from "node:test"

import { ReferenceCache } from "../../src/frontend/components/output/gpu/ReferenceCache.ts"

test("shared resources remain alive until every owner releases them", async () => {
    const disposed = []
    const cache = new ReferenceCache((resource) => disposed.push(resource.id))

    const first = await cache.acquire("welcome", async () => ({ id: "texture-welcome" }))
    const second = await cache.acquire("welcome", async () => ({ id: "unused" }))
    cache.release("welcome")

    assert.equal(first, second)
    assert.deepEqual(cache.snapshot(), { entries: 1, references: 1 })
    assert.deepEqual(disposed, [])

    cache.release("welcome")
    assert.deepEqual(cache.snapshot(), { entries: 0, references: 0 })
    assert.deepEqual(disposed, ["texture-welcome"])
})

test("one hundred replaced resources leave no retained cache entries", async () => {
    const disposed = []
    const cache = new ReferenceCache((resource) => disposed.push(resource.id))

    for (let index = 0; index < 100; index++) {
        const key = `slide-${index}`
        await cache.acquire(key, async () => ({ id: key }))
        cache.release(key)
    }

    assert.deepEqual(cache.snapshot(), { entries: 0, references: 0 })
    assert.equal(disposed.length, 100)
})

test("clear releases all resources regardless of outstanding owners", async () => {
    const disposed = []
    const cache = new ReferenceCache((resource) => disposed.push(resource.id))
    await cache.acquire("one", async () => ({ id: "one" }))
    await cache.acquire("two", async () => ({ id: "two" }))

    cache.clear()

    assert.deepEqual(cache.snapshot(), { entries: 0, references: 0 })
    assert.deepEqual(disposed.sort(), ["one", "two"])
})
