import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Show } from "../../../types/Show"

// same mocks as templateApply.test.ts: historyActions pulls in most of the app
vi.mock("../../IPC/main", () => ({ sendMain: vi.fn(), requestMain: vi.fn() }))
vi.mock("../../utils/common", () => ({ isMainWindow: () => true }))
vi.mock("../../utils/save", () => ({ save: vi.fn() }))
vi.mock("../actions/actions", () => ({ customActionActivation: vi.fn() }))
vi.mock("./showActions", () => ({ getItemWithMostLines: () => 1 }))
vi.mock("./setShow", () => ({ loadShows: vi.fn(), saveTextCache: vi.fn() }))
vi.mock("./historyHelpers", () => ({ _updaters: {} }))
vi.mock("./show", () => ({ getShowCacheId: (id: string) => id, removeTemplatesFromShow: vi.fn() }))

import { getShowsCache, setShowsCache } from "../../showsCacheState/showsCache.svelte"
import { activeShow, undoHistory } from "../../stores"
import { history, redo, undo } from "./history"

const slide = (value: string) => ({ group: "g", color: null, settings: {}, notes: "", items: [{ type: "text", style: "", align: "", lines: [{ align: "", text: [{ value, style: "font-size: 80px;" }] }] }] })
const show = () => ({ name: "t", category: null, settings: { activeLayout: "L", template: "tpl" }, timestamps: { created: 0, modified: null, used: null }, meta: {}, slides: { s1: slide("one"), s2: slide("two"), s3: slide("three") }, layouts: { L: { name: "L", notes: "", slides: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] } }, media: {} }) as any as Show

const fontSizes = () => Object.values(getShowsCache().sh.slides).map((s: any) => s.items[0].lines[0].text[0].style)

beforeEach(() => {
    vi.stubGlobal("document", { activeElement: null })
    undoHistory.set([])
    activeShow.set({ id: "sh", type: "show" } as any)
    setShowsCache({ sh: show() })
})

describe("textScope history entry", () => {
    const writeAll = () =>
        history({
            id: "textScope",
            newData: { writes: ["s1", "s2", "s3"].map((slideId) => ({ id: "textStyle", slide: slideId, items: [0], style: { key: "text", values: [[[{ value: slideId, style: "font-size: 120px;" }]]] } })) },
            location: { page: "edit", show: get(activeShow)! }
        })

    it("changes every slide as one history entry and undo restores all of them", () => {
        const before = structuredClone(getShowsCache().sh)
        writeAll()
        expect(fontSizes()).toEqual(["font-size: 120px;", "font-size: 120px;", "font-size: 120px;"])
        expect(get(undoHistory)).toHaveLength(1)

        undo()
        expect(getShowsCache().sh.slides).toEqual(before.slides)
        expect(getShowsCache().sh.settings).toEqual(before.settings)
        expect(get(undoHistory)).toHaveLength(0)

        redo()
        expect(fontSizes()).toEqual(["font-size: 120px;", "font-size: 120px;", "font-size: 120px;"])
    })

    it("leaves slides without a write alone", () => {
        history({ id: "textScope", newData: { writes: [{ id: "textStyle", slide: "s2", items: [0], style: { key: "text", values: [[[{ value: "two", style: "font-size: 10px;" }]]] } }] }, location: { page: "edit", show: get(activeShow)! } })
        expect(fontSizes()).toEqual(["font-size: 80px;", "font-size: 10px;", "font-size: 80px;"])
    })

    it("sets whole item lists (reset to template) and undo restores them", () => {
        const before = structuredClone(getShowsCache().sh.slides)
        const items = [{ type: "text", style: "", align: "", lines: [{ align: "", text: [{ value: "one", style: "font-size: 50px;" }] }] }]
        history({ id: "textScope", newData: { items: { s1: items }, detach: false }, location: { page: "edit", show: get(activeShow)! } })
        expect(fontSizes()[0]).toBe("font-size: 50px;")
        expect(getShowsCache().sh.settings.template).toBe("tpl")

        undo()
        expect(getShowsCache().sh.slides).toEqual(before)
    })

    it("does not mutate the show it read before the write", () => {
        const read = getShowsCache().sh
        const snapshot = JSON.stringify(read)
        writeAll()
        expect(JSON.stringify(read)).toBe(snapshot)
    })
})
