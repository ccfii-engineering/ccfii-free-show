import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Show } from "../../../types/Show"

// historyActions pulls in most of the app (window, popups, pdfjs); the TEMPLATE action only needs the stores and the merge helpers
vi.mock("../../IPC/main", () => ({ sendMain: vi.fn(), requestMain: vi.fn() }))
vi.mock("../../utils/common", () => ({ isMainWindow: () => true }))
vi.mock("../../utils/save", () => ({ save: vi.fn() }))
vi.mock("../actions/actions", () => ({ customActionActivation: vi.fn() }))
vi.mock("./showActions", () => ({ getItemWithMostLines: () => 1 }))
vi.mock("./setShow", () => ({ loadShows: vi.fn(), saveTextCache: vi.fn() }))
vi.mock("./historyHelpers", () => ({ _updaters: {} }))
vi.mock("./show", () => ({ getShowCacheId: (id: string) => id, removeTemplatesFromShow: vi.fn() }))

import { getShowsCache, setShowsCache, showsCache } from "../../showsCacheState/showsCache.svelte"
import { activePage, activeShow, categories, templates, undoHistory } from "../../stores"
import { history, redo, restyleShowWithTemplate, undo } from "./history"

const line = (value: string) => ({ align: "", text: [{ value, style: "" }] })
const slide = (value: string) => ({ group: "g", color: null, settings: {}, notes: "", items: [{ type: "text", style: "", align: "", lines: [line(value)] }] })

function makeShow(template: string | null): Show {
    return { name: "t", category: null, settings: { activeLayout: "L", template }, timestamps: { created: 0, modified: null, used: null }, meta: {}, slides: { s1: slide("one"), s2: slide("two") }, layouts: { L: { name: "L", notes: "", slides: [{ id: "s1" }, { id: "s2" }] } }, media: {} } as any
}

const TEMPLATE_STYLE = "font-size: 77px;"

beforeEach(() => {
    templates.set({ tpl: { name: "tpl", color: null, category: null, settings: {}, items: [{ type: "text", style: "left:0px;top:0px;width:100px;height:100px;", align: "", lines: [{ align: "", text: [{ value: "", style: TEMPLATE_STYLE }] }] }] } } as any)
    activeShow.set({ id: "sh", type: "show" } as any)
})

// what a subscriber of the cache last saw, as JSON (in-place mutations after the last notification are invisible to it)
function watch() {
    let seen = ""
    const stop = showsCache.subscribe((record) => (seen = JSON.stringify(record.sh)))
    return { seen: () => seen, stop }
}

describe("whole-show TEMPLATE apply", () => {
    for (const [name, startTemplate] of [
        ["a new template id", null],
        ["the template id the show already has", "tpl"]
    ] as const) {
        it(`notifies subscribers of the applied slides (${name})`, () => {
            setShowsCache({ sh: makeShow(startTemplate) })
            const watcher = watch()
            history({ id: "TEMPLATE", newData: { id: "tpl", data: { createItems: true } }, location: { page: "none", override: "show#sh" } })

            const current = getShowsCache().sh
            expect(JSON.stringify(current.slides.s1.items)).toContain(TEMPLATE_STYLE)
            expect(current.settings.template).toBe("tpl")
            expect(watcher.seen()).toBe(JSON.stringify(current))
            watcher.stop()
        })
    }

    it("does not mutate the show it read before the write", () => {
        setShowsCache({ sh: makeShow("tpl") })
        const before = getShowsCache().sh
        const snapshot = JSON.stringify(before)
        history({ id: "TEMPLATE", newData: { id: "tpl", data: { createItems: true } }, location: { page: "none", override: "show#sh" } })
        expect(JSON.stringify(before)).toBe(snapshot)
        expect(get(showsCache).sh).not.toBe(before)
    })

    it("breaks long lines with the template's break point", () => {
        templates.update((a: any) => ({ ...a, tpl: { ...a.tpl, settings: { breakLongLines: "3" } } }))
        const show = makeShow(null)
        ;(show.slides.s1.items[0] as any).lines = [line("one two three four five six seven")]
        setShowsCache({ sh: show })
        history({ id: "TEMPLATE", newData: { id: "tpl", data: { createItems: true } }, location: { page: "none", override: "show#sh" } })
        expect((getShowsCache().sh.slides.s1.items[0] as any).lines.length).toBeGreaterThan(1)
    })
})

describe("selected-slide template apply", () => {
    it("restyles only the slide that got its own template", () => {
        templates.update((a: any) => ({ ...a, other: { ...a.tpl, name: "other", items: [{ ...a.tpl.items[0], lines: [{ align: "", text: [{ value: "", style: "font-size: 11px;" }] }] }] } }))
        setShowsCache({ sh: makeShow("tpl") })
        history({ id: "TEMPLATE", save: false, newData: { id: "tpl", data: { createItems: true } }, location: { page: "none", override: "show#sh" } })
        expect(JSON.stringify(getShowsCache().sh.slides.s2.items)).toContain(TEMPLATE_STYLE)

        history({ id: "slideStyle", oldData: { style: {} }, newData: { style: { template: "other" } }, location: { page: "edit", show: get(activeShow)!, slide: "s2" } })
        const slides = getShowsCache().sh.slides
        expect(JSON.stringify(slides.s2.items)).toContain("font-size: 11px;")
        expect(JSON.stringify(slides.s2.items)).not.toContain(TEMPLATE_STYLE)
        expect(JSON.stringify(slides.s1.items)).toContain(TEMPLATE_STYLE)
        expect(slides.s2.settings.template).toBe("other")
    })

    describe("slideTemplate (one step per click)", () => {
        const apply = (slideIds: string[]) => history({ id: "slideTemplate", newData: { template: "other", slideIds }, location: { page: "edit", show: get(activeShow)! } })
        const own = () =>
            Object.entries(getShowsCache().sh.slides)
                .filter(([, sl]) => sl.settings?.template)
                .map(([id]) => id)

        beforeEach(() => {
            vi.stubGlobal("document", { activeElement: null })
            undoHistory.set([])
            templates.update((a: any) => ({ ...a, other: { ...a.tpl, name: "other", items: [{ ...a.tpl.items[0], lines: [{ align: "", text: [{ value: "", style: "font-size: 11px;" }] }] }] } }))
            setShowsCache({ sh: makeShow("tpl") })
            history({ id: "TEMPLATE", save: false, newData: { id: "tpl", data: { createItems: true } }, location: { page: "none", override: "show#sh" } })
        })

        it("undo restores the slides deep-equal to before and redo re-applies the template", () => {
            const before = structuredClone(getShowsCache().sh)
            apply(["s2"])
            const applied = structuredClone(getShowsCache().sh)
            expect(own()).toEqual(["s2"])
            expect(JSON.stringify(applied.slides.s2.items)).toContain("font-size: 11px;")
            expect(get(undoHistory)).toHaveLength(1)

            undo()
            const undone = getShowsCache().sh
            expect(undone.slides).toEqual(before.slides)
            expect(undone.layouts).toEqual(before.layouts)
            expect(own()).toEqual([])

            redo()
            expect(getShowsCache().sh.slides).toEqual(applied.slides)
            expect(own()).toEqual(["s2"])
        })

        it("several slides are one history step", () => {
            const before = structuredClone(getShowsCache().sh.slides)
            apply(["s1", "s2"])
            expect(own()).toEqual(["s1", "s2"])
            expect(get(undoHistory)).toHaveLength(1)
            undo()
            expect(getShowsCache().sh.slides).toEqual(before)
        })
    })
})

describe("a show that is not the desktop's active show", () => {
    const styleOf = (id: string, slideId = "s1") => JSON.stringify(getShowsCache()[id].slides[slideId].items)

    beforeEach(() => {
        vi.stubGlobal("document", { activeElement: null })
        undoHistory.set([])
        activePage.set("settings")
        templates.update((a: any) => ({ ...a, other: { ...a.tpl, name: "other", items: [{ ...a.tpl.items[0], lines: [{ align: "", text: [{ value: "", style: "font-size: 11px;" }] }] }] } }))
        setShowsCache({ sh: makeShow(null), ipad: makeShow(null) })
    })

    it("whole-show TEMPLATE styles the show named in the request, not the active one", () => {
        history({ id: "TEMPLATE", newData: { id: "tpl", showId: "ipad", data: { createItems: true } }, location: { page: "none", override: "show#ipad" } })

        expect(styleOf("ipad")).toContain(TEMPLATE_STYLE)
        expect(getShowsCache().ipad.settings.template).toBe("tpl")
        expect(styleOf("sh")).not.toContain(TEMPLATE_STYLE)
        expect(getShowsCache().sh.settings.template).toBeNull()
        expect(get(activePage)).toBe("settings")
    })

    it("undo and redo go back to the show the apply targeted", () => {
        const before = structuredClone(getShowsCache().ipad.slides)
        history({ id: "TEMPLATE", newData: { id: "tpl", showId: "ipad", data: { createItems: true } }, location: { page: "none" } })
        const applied = structuredClone(getShowsCache().ipad.slides)
        // the operator moves on to another show before undoing
        activeShow.set({ id: "sh", type: "show" })

        undo()
        expect(getShowsCache().ipad.slides).toEqual(before)
        expect(getShowsCache().ipad.settings.template).toBeNull()
        expect(styleOf("sh")).not.toContain(TEMPLATE_STYLE)

        redo()
        expect(getShowsCache().ipad.slides).toEqual(applied)
        expect(getShowsCache().ipad.settings.template).toBe("tpl")
    })

    it("applies with no active show on the desktop", () => {
        activeShow.set(null)
        history({ id: "TEMPLATE", newData: { id: "tpl", showId: "ipad", data: { createItems: true } }, location: { page: "none" } })
        expect(styleOf("ipad")).toContain(TEMPLATE_STYLE)
    })

    it("uses the target show's own active layout", () => {
        const show = makeShow(null)
        show.settings.activeLayout = "M"
        show.layouts = { L: { name: "L", notes: "", slides: [{ id: "s1" }] }, M: { name: "M", notes: "", slides: [{ id: "s2" }, { id: "s1" }] } }
        setShowsCache({ sh: makeShow(null), ipad: show })
        history({ id: "TEMPLATE", save: false, newData: { id: "tpl", showId: "ipad", indexes: [0], data: { createItems: true } }, location: { page: "none" } })
        // index 0 of layout M is s2
        expect(styleOf("ipad", "s2")).toContain(TEMPLATE_STYLE)
        expect(styleOf("ipad", "s1")).not.toContain(TEMPLATE_STYLE)
    })

    it("slideTemplate restyles the slides of a show that is not open, without moving the page", () => {
        history({ id: "TEMPLATE", save: false, newData: { id: "tpl", showId: "ipad", data: { createItems: true } }, location: { page: "none" } })
        history({ id: "slideTemplate", newData: { template: "other", slideIds: ["s2"] }, location: { page: "none", show: { id: "ipad" } } })

        expect(styleOf("ipad", "s2")).toContain("font-size: 11px;")
        expect(styleOf("ipad", "s2")).not.toContain(TEMPLATE_STYLE)
        expect(styleOf("ipad", "s1")).toContain(TEMPLATE_STYLE)
        expect(styleOf("sh", "s2")).not.toContain("font-size: 11px;")
        expect(getShowsCache().ipad.slides.s2.settings.template).toBe("other")
        expect(get(activePage)).toBe("settings")
    })

    it("restyleShowWithTemplate re-applies the template a show uses, and the category template wins", () => {
        const show = makeShow("tpl")
        setShowsCache({ sh: makeShow(null), ipad: show })
        restyleShowWithTemplate("ipad")
        expect(styleOf("ipad")).toContain(TEMPLATE_STYLE)

        categories.set({ cat: { name: "cat", template: "other" } })
        setShowsCache({ sh: makeShow(null), ipad: { ...makeShow("tpl"), category: "cat" } })
        restyleShowWithTemplate("ipad")
        expect(styleOf("ipad")).toContain("font-size: 11px;")
        categories.set({})
    })
})
