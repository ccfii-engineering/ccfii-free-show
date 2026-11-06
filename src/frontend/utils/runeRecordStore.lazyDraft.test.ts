import { describe, expect, it, vi } from "vitest"
import { createRuneRecordStore } from "./runeRecordStore.svelte"

type Item = { name: string; nested: { n: number } }

function lazy() {
    const store = createRuneRecordStore<Item>({}, { lazyDraft: true })
    store.set({ a: { name: "a", nested: { n: 1 } }, b: { name: "b", nested: { n: 1 } }, c: { name: "c", nested: { n: 1 } } })
    return store
}

describe("createRuneRecordStore lazyDraft option", () => {
    it("update() mutates only the touched entry and keeps the other references", () => {
        const store = lazy()
        const before = store.get()
        store.update((draft) => {
            draft.b.nested.n = 5
            return draft
        })
        const after = store.get()
        expect(after.b.nested.n).toBe(5)
        expect(after.a).toBe(before.a)
        expect(after.c).toBe(before.c)
        expect(before.b.nested.n).toBe(1)
    })

    it("update() adds entries without copying the ones it never reads", () => {
        const store = lazy()
        const before = store.get()
        store.update((draft) => {
            draft.d = { name: "d", nested: { n: 0 } }
        })
        expect(store.get().a).toBe(before.a)
        expect(Object.keys(store.get())).toEqual(["a", "b", "c", "d"])
    })

    it("supports delete, Object.values and returning a new record", () => {
        const store = lazy()
        store.update((draft) => {
            delete draft.a
            return draft
        })
        expect(Object.keys(store.get())).toEqual(["b", "c"])
        store.update((draft) => {
            Object.values(draft).forEach((item) => (item.name += "!"))
        })
        expect(store.get().c.name).toBe("c!")
        store.update((draft) => ({ ...draft, z: { name: "z", nested: { n: 9 } } }))
        expect(Object.keys(store.get())).toEqual(["b", "c", "z"])
    })

    it("a read-only update notifies nobody", () => {
        const store = lazy()
        const run = vi.fn()
        store.subscribe(run)
        run.mockClear()
        store.update((draft) => {
            void draft.a.name
            return draft
        })
        expect(run).not.toHaveBeenCalled()
    })
})
