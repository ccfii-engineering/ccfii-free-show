import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Show } from "../../types/Show"
import { getCachedShow, getShowsCache, patchCachedShow, putCachedShow, removeCachedShow, selectCachedShow, setShowsCache, showsCache, updateShowsCache, writableShowsCache } from "./showsCache.svelte"

const show = (name: string): Show => ({ name, category: null, settings: {}, timestamps: { created: 0, modified: null, used: null }, meta: {}, slides: {}, layouts: {}, media: {} }) as Show

beforeEach(() => {
    setShowsCache({ one: show("one"), two: show("two"), three: show("three") })
})

describe("shows cache domain module", () => {
    it("exposes a read-only store", () => {
        expect((showsCache as any).set).toBeUndefined()
        expect((showsCache as any).update).toBeUndefined()
        expect(Object.keys(get(showsCache))).toEqual(["one", "two", "three"])
        expect(getCachedShow("two")?.name).toBe("two")
        expect(getShowsCache().one.name).toBe("one")
    })

    it("updateShowsCache edits one show in place without touching the others", () => {
        const before = getShowsCache()
        const run = vi.fn()
        const stop = showsCache.subscribe(run)
        run.mockClear()
        updateShowsCache((a) => {
            a.two.name = "renamed"
            return a
        })
        expect(run).toHaveBeenCalledTimes(1)
        expect(getShowsCache().one).toBe(before.one)
        expect(getShowsCache().three).toBe(before.three)
        expect(getShowsCache().two.name).toBe("renamed")
        expect(before.two.name).toBe("two")
        stop()
    })

    it("no-op update notifies nobody", () => {
        const run = vi.fn()
        const stop = showsCache.subscribe(run)
        run.mockClear()
        updateShowsCache((a) => a)
        updateShowsCache((a) => {
            a.one.name = "one"
            return a
        })
        expect(run).not.toHaveBeenCalled()
        stop()
    })

    it("selectCachedShow wakes only the changed show", () => {
        const one = vi.fn()
        const two = vi.fn()
        const stopOne = selectCachedShow("one").subscribe(one)
        const stopTwo = selectCachedShow("two").subscribe(two)
        one.mockClear()
        two.mockClear()
        patchCachedShow("two", { name: "x" })
        expect(one).not.toHaveBeenCalled()
        expect(two).toHaveBeenCalledTimes(1)
        stopOne()
        stopTwo()
    })

    it("put/remove/set and the writable face delegate to the module", () => {
        putCachedShow("four", show("four"))
        expect(getCachedShow("four")?.name).toBe("four")
        removeCachedShow("four")
        expect(getCachedShow("four")).toBeUndefined()
        writableShowsCache.set({})
        expect(Object.keys(getShowsCache())).toEqual([])
    })
})
