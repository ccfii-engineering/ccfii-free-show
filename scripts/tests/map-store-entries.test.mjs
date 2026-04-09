import assert from "node:assert/strict"
import { test } from "node:test"
import { updateMappedEntries } from "../../src/frontend/utils/mapStoreEntries.ts"

test("returns original map when nothing changes", () => {
    const map = { a: { value: 1 }, b: { value: 2 } }
    const next = updateMappedEntries(map, ["a"], (entry) => entry)

    assert.equal(next, map)
})

test("reassigns only touched entries", () => {
    const map = { a: { value: 1 }, b: { value: 2 } }
    const next = updateMappedEntries(map, ["a"], (entry) => ({ ...entry, value: entry.value + 1 }))

    assert.notEqual(next, map)
    assert.notEqual(next.a, map.a)
    assert.equal(next.b, map.b)
    assert.deepEqual(next, { a: { value: 2 }, b: { value: 2 } })
})

test("ignores missing ids", () => {
    const map = { a: { value: 1 } }
    const next = updateMappedEntries(map, ["missing"], (entry) => ({ ...entry, value: entry.value + 1 }))

    assert.equal(next, map)
})
