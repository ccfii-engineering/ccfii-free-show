import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Show } from "../../../types/Show"

// the helpers pull in the app's IPC and popups; only the stores and cache helpers matter here
vi.mock("../../IPC/main", () => ({ sendMain: vi.fn(), requestMain: vi.fn() }))
vi.mock("../../utils/common", () => ({ isMainWindow: () => true }))
vi.mock("../actions/actions", () => ({ customActionActivation: vi.fn() }))
vi.mock("../edit/scripts/itemHelpers", () => ({ getDynamicValue: vi.fn() }))

import { getShowsCache, setShowsCache, showsCache, updateShowsCache } from "../../showsCacheState/showsCache.svelte"
import { activeShow } from "../../stores"
import { createGlobalTimerFromLocalTimer } from "../drawer/timers/timers"
import { _show } from "./shows"

const slide = (group: string) => ({ group, color: null, settings: {}, notes: "", items: [] })

function makeShow(): Show {
    return { name: "t", category: null, settings: { activeLayout: "L", template: "tpl" }, timestamps: { created: 0, modified: null, used: null }, meta: {}, slides: { a: slide("a"), b: slide("b"), c: slide("c") }, layouts: { L: { name: "L", notes: "", slides: [{ id: "a" }, { id: "gone1" }, { id: "gone2" }, { id: "b" }, { id: "c" }] } }, media: {} }
}

beforeEach(() => {
    setShowsCache({ sh: makeShow() })
    activeShow.set({ id: "sh", type: "show" } as any)
})

describe("layout ref cleans dangling slide references", () => {
    it("removes every dangling layout slide and keeps the valid ones", () => {
        const ref = _show("sh").layouts("active").ref()[0]
        expect(ref.map((r) => r.id)).toEqual(["a", "b", "c"])
        expect(getShowsCache().sh.layouts.L.slides.map((s) => s.id)).toEqual(["a", "b", "c"])
    })

    it("removes every dangling child slide of a parent", () => {
        const show = makeShow()
        show.layouts.L.slides = [{ id: "a" }, { id: "b" }]
        ;(show.slides.a as any).children = ["x1", "c", "x2", "x3"]
        setShowsCache({ sh: show })
        _show("sh").layouts("active").ref()
        expect((getShowsCache().sh.slides.a as any).children).toEqual(["c"])
    })
})

describe("writes nested inside updateShowsCache", () => {
    it("are replaced by the outer commit, so callers write one after the other", () => {
        // ShowHeader locked a show and cleared its template inside one update; the template write was lost
        updateShowsCache((a) => {
            a.sh.locked = true
            _show("sh").set({ key: "settings.template", value: null })
            return a
        })
        expect(getShowsCache().sh.locked).toBe(true)
        expect(getShowsCache().sh.settings.template).toBe("tpl")

        updateShowsCache((a) => {
            a.sh.locked = false
            return a
        })
        _show("sh").set({ key: "settings.template", value: null })
        expect(getShowsCache().sh.settings.template).toBe(null)
    })

    it("a show read with _show().get() is the live cached object, a clone is safe to edit", () => {
        const run = vi.fn()
        const stop = showsCache.subscribe(run)
        run.mockClear()
        const live = _show("sh").get()
        expect(live).toBe(getShowsCache().sh)
        const copy = structuredClone(live)
        copy.name = "renamed"
        expect(getShowsCache().sh.name).toBe("t")
        updateShowsCache((a) => {
            a.sh = copy
            return a
        })
        expect(run).toHaveBeenCalledTimes(1)
        stop()
    })
})

describe("global timer creation from a show timer", () => {
    it("writes the timer id through the cache so subscribers hear about it", () => {
        const show = makeShow()
        show.slides.a.items = [{ type: "timer", timer: { type: "counter", start: 10 } }] as any
        setShowsCache({ sh: show })
        const run = vi.fn()
        const stop = showsCache.subscribe(run)
        run.mockClear()
        createGlobalTimerFromLocalTimer("sh")
        expect(run).toHaveBeenCalled()
        expect((getShowsCache().sh.slides.a.items[0] as any).timerId).toBeTruthy()
        stop()
    })
})
