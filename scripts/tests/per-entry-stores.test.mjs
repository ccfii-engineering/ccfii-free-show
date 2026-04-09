import assert from "node:assert/strict"
import { test } from "node:test"
import { writable } from "svelte/store"
import { createEntryAccessor } from "../../src/frontend/utils/perEntryStoresFactory.ts"

// Helper: subscribe and collect emissions. Deep-clones each value so later in-place
// mutations don't retroactively change captured snapshots.
const collect = (readable) => {
    const seen = []
    const unsub = readable.subscribe((v) => seen.push(v === null || v === undefined ? v : JSON.parse(JSON.stringify(v))))
    return { seen, unsub }
}

test("initial subscribe emits current entry", () => {
    const store = writable({ a: { name: "Alpha" }, b: { name: "Beta" } })
    const entry = createEntryAccessor(store)

    const { seen, unsub } = collect(entry("a"))
    assert.deepEqual(seen, [{ name: "Alpha" }])
    unsub()
})

test("missing key emits null", () => {
    const store = writable({ a: { name: "Alpha" } })
    const entry = createEntryAccessor(store)

    const { seen, unsub } = collect(entry("missing"))
    assert.deepEqual(seen, [null])
    unsub()
})

test("empty key returns empty sentinel (cached)", () => {
    const store = writable({ a: 1 })
    const entry = createEntryAccessor(store)

    assert.equal(entry(""), entry(""), "same readable cached for empty key")
    const { seen, unsub } = collect(entry(""))
    assert.deepEqual(seen, [null])
    unsub()
})

test("same key returns same cached readable", () => {
    const store = writable({ a: { x: 1 } })
    const entry = createEntryAccessor(store)

    assert.equal(entry("a"), entry("a"), "repeat call returns same Readable")
})

test("only emits for subscribers when THIS key changes (reassign)", () => {
    const store = writable({ a: { v: 1 }, b: { v: 10 } })
    const entry = createEntryAccessor(store)

    const aCollector = collect(entry("a"))
    const bCollector = collect(entry("b"))

    // Reassign b only (proper ref-change update)
    store.update((s) => ({ ...s, b: { v: 20 } }))

    assert.deepEqual(aCollector.seen, [{ v: 1 }], "a subscriber did NOT re-fire")
    assert.deepEqual(bCollector.seen, [{ v: 10 }, { v: 20 }], "b subscriber saw both")

    aCollector.unsub()
    bCollector.unsub()
})

test("JSON gate handles in-place mutations", () => {
    // Simulates legacy in-place mutation sites that still exist in the codebase.
    const store = writable({ a: { v: 1 }, b: { v: 10 } })
    const entry = createEntryAccessor(store)

    const bCollector = collect(entry("b"))

    // In-place mutation of b — same top-level ref, but inner value changes.
    store.update((s) => {
        s.b.v = 20
        return s
    })

    assert.deepEqual(bCollector.seen, [{ v: 10 }, { v: 20 }], "JSON gate caught the in-place mutation")

    bCollector.unsub()
})

test("in-place mutation emits a FRESH ref (immutable-compatible)", () => {
    // Critical for <svelte:options immutable>: the derived store must emit a new object
    // reference even when the parent was mutated in-place — otherwise immutable components
    // compare refs and see no change.
    const store = writable({ a: { v: 1 } })
    const entry = createEntryAccessor(store)

    const refs = []
    const unsub = entry("a").subscribe((v) => refs.push(v))

    store.update((s) => {
        s.a.v = 2
        return s
    })

    assert.equal(refs.length, 2, "two emissions")
    assert.notEqual(refs[0], refs[1], "refs must differ — in-place mutation was cloned")
    assert.deepEqual(refs[1], { v: 2 })

    unsub()
})

test("no emission when unrelated key mutates (in-place, JSON same for my key)", () => {
    const store = writable({ a: { v: 1 }, b: { v: 10 } })
    const entry = createEntryAccessor(store)

    const aCollector = collect(entry("a"))

    // In-place mutation of b
    store.update((s) => {
        s.b.v = 999
        return s
    })

    assert.deepEqual(aCollector.seen, [{ v: 1 }], "a subscriber did not fire on b change")

    aCollector.unsub()
})

test("no duplicate emission when JSON is unchanged (deduplication)", () => {
    const store = writable({ a: { v: 1 } })
    const entry = createEntryAccessor(store)

    const { seen, unsub } = collect(entry("a"))

    // Update store with a completely new object equal to old value.
    store.update((s) => ({ ...s, a: { v: 1 } }))
    store.update((s) => ({ ...s, a: { v: 1 } }))
    store.update((s) => ({ ...s, a: { v: 1 } }))

    assert.deepEqual(seen, [{ v: 1 }], "only initial emission despite 3 updates")

    unsub()
})

test("key added later emits new value", () => {
    const store = writable({})
    const entry = createEntryAccessor(store)

    const { seen, unsub } = collect(entry("a"))
    assert.deepEqual(seen, [null])

    store.update((s) => ({ ...s, a: { v: 42 } }))
    assert.deepEqual(seen, [null, { v: 42 }])

    unsub()
})

test("key removed emits null", () => {
    const store = writable({ a: { v: 1 } })
    const entry = createEntryAccessor(store)

    const { seen, unsub } = collect(entry("a"))

    store.update((s) => {
        const next = { ...s }
        delete next.a
        return next
    })

    assert.deepEqual(seen, [{ v: 1 }, null])
    unsub()
})
