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
import { activeShow, templates } from "../../stores"
import { history } from "./history"

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
})
