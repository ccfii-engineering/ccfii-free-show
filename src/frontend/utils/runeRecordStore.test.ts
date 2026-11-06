import { flushSync } from "svelte"
import { get } from "svelte/store"
import { describe, expect, it, vi } from "vitest"
import { createRuneRecordStore } from "./runeRecordStore.svelte"
import { trackEntry } from "./runeRecordStore.fixture.svelte"

type Item = { name: string; nested: { n: number }; list?: number[] }

function seeded() {
    const store = createRuneRecordStore<Item>()
    store.set({ a: { name: "a", nested: { n: 1 } }, b: { name: "b", nested: { n: 1 } }, c: { name: "c", nested: { n: 1 } } })
    return store
}

describe("createRuneRecordStore", () => {
    it("is store compatible: get() and subscribe() deliver the record synchronously", () => {
        const store = seeded()
        expect(get(store)).toEqual({ a: { name: "a", nested: { n: 1 } }, b: { name: "b", nested: { n: 1 } }, c: { name: "c", nested: { n: 1 } } })
        const seen: string[][] = []
        const stop = store.subscribe((v) => seen.push(Object.keys(v)))
        expect(seen).toEqual([["a", "b", "c"]])
        store.patch("a", { name: "a2" })
        expect(seen).toHaveLength(2)
        stop()
        store.patch("a", { name: "a3" })
        expect(seen).toHaveLength(2)
    })

    it("keeps key order and drops removed keys on set()", () => {
        const store = seeded()
        store.set({ c: { name: "c", nested: { n: 1 } }, a: { name: "a", nested: { n: 1 } } })
        expect(Object.keys(store.get())).toEqual(["c", "a"])
        expect(store.getEntry("b")).toBeUndefined()
    })

    it("update() accepts legacy in-place mutation and only notifies for real changes", () => {
        const store = seeded()
        const run = vi.fn()
        store.subscribe(run)
        run.mockClear()

        store.update((draft) => {
            draft.b.nested.n = 1
            return draft
        })
        expect(run).not.toHaveBeenCalled()

        store.update((draft) => {
            draft.b.nested.n = 2
            return draft
        })
        expect(run).toHaveBeenCalledTimes(1)
        expect(store.get().b.nested.n).toBe(2)
    })

    it("update() keeps references of untouched entries and replaces only the changed one", () => {
        const store = seeded()
        const before = store.get()
        store.update((draft) => {
            draft.b.nested.n = 5
        })
        const after = store.get()
        expect(after).not.toBe(before)
        expect(after.a).toBe(before.a)
        expect(after.c).toBe(before.c)
        expect(after.b).not.toBe(before.b)
    })

    it("patch() accepts a partial or an updater and ignores unknown ids", () => {
        const store = seeded()
        store.patch("a", (item) => ({ ...item, name: "fn" }))
        store.patch("a", { name: "partial" })
        store.patch("missing", { name: "x" })
        expect(store.get().a.name).toBe("partial")
        expect(store.get().missing).toBeUndefined()
    })

    it("put() adds an entry and remove() deletes one", () => {
        const store = seeded()
        store.put("d", { name: "d", nested: { n: 0 } })
        expect(Object.keys(store.get())).toEqual(["a", "b", "c", "d"])
        store.remove("a")
        expect(Object.keys(store.get())).toEqual(["b", "c", "d"])
    })

    it("select(id) runs only when that entry changes", () => {
        const store = seeded()
        const runA = vi.fn()
        const runB = vi.fn()
        const stopA = store.select("a").subscribe(runA)
        const stopB = store.select("b").subscribe(runB)
        flushSync()
        expect(runA).toHaveBeenCalledTimes(1)
        expect(runB).toHaveBeenCalledTimes(1)

        store.patch("b", { name: "b2" })
        flushSync()
        expect(runA).toHaveBeenCalledTimes(1)
        expect(runB).toHaveBeenCalledTimes(2)
        expect(runB).toHaveBeenLastCalledWith(expect.objectContaining({ name: "b2" }))

        stopA()
        stopB()
        store.patch("b", { name: "b3" })
        flushSync()
        expect(runB).toHaveBeenCalledTimes(2)
    })

    it("select(id) is synchronous and runs once per real change of that entry", () => {
        const store = seeded()
        const run = vi.fn()
        const stop = store.select("a").subscribe(run)
        run.mockClear()
        store.patch("a", { name: "1" })
        expect(run).toHaveBeenCalledTimes(1)
        store.patch("a", { name: "1" })
        expect(run).toHaveBeenCalledTimes(1)
        store.patch("a", { name: "2" })
        expect(run).toHaveBeenCalledTimes(2)
        stop()
    })

    it("getEntry(id) is a rune signal per entry: an effect reading one entry ignores the others", () => {
        const store = seeded()
        const log = trackEntry(store, "a")
        flushSync()
        store.patch("b", { name: "other" })
        flushSync()
        expect(log).toHaveLength(1)
        store.patch("a", { name: "mine" })
        flushSync()
        expect(log).toHaveLength(2)
    })

    it("select(id) does not lose a write that lands before the first effect run", () => {
        const store = seeded()
        const run = vi.fn()
        const stop = store.select("a").subscribe(run)
        store.patch("a", { name: "early" })
        flushSync()
        expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ name: "early" }))
        expect(run).toHaveBeenCalledTimes(2)
        stop()
    })

    it("select(id) reports undefined after removal", () => {
        const store = seeded()
        const run = vi.fn()
        const stop = store.select("a").subscribe(run)
        flushSync()
        store.remove("a")
        flushSync()
        expect(run).toHaveBeenLastCalledWith(undefined)
        stop()
    })
})
