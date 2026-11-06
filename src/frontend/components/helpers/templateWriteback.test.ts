import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Show } from "../../../types/Show"
import { getShowsCache, setShowsCache } from "../../showsCacheState/showsCache.svelte"
import { activeShow, undoHistory } from "../../stores"
import { clone } from "./array"
import { history, undo } from "./history"
import { _show, getSlideSettings } from "./shows"

// historyActions pulls in most of the app (pdfjs, window, svelte popups); slideStyle does not use it
vi.mock("./historyActions", () => ({ historyActions: () => ({}) }))
vi.mock("./show", () => ({ removeTemplatesFromShow: vi.fn() }))
vi.mock("../../IPC/main", () => ({ sendMain: vi.fn(), requestMain: vi.fn() }))
vi.mock("../../utils/common", () => ({ isMainWindow: () => true }))
vi.mock("./setShow", () => ({ loadShows: vi.fn() }))

const SLIDES = ["s1", "s2", "s3", "s4", "s5", "s6"]

function makeShow(): Show {
    const slides: any = {}
    SLIDES.forEach((id) => (slides[id] = { group: id, color: null, settings: {}, notes: "", items: [] }))
    return { name: "t", category: null, settings: { activeLayout: "L", template: null }, timestamps: { created: 0, modified: null, used: null }, meta: {}, slides, layouts: { L: { name: "L", notes: "", slides: SLIDES.map((id) => ({ id })) } }, media: {} }
}

const own = () => SLIDES.filter((id) => getShowsCache().sh.slides[id].settings?.template)

beforeEach(() => {
    setShowsCache({ sh: makeShow() })
    activeShow.set({ id: "sh", type: "show" } as any)
    undoHistory.set([])
    vi.stubGlobal("document", { activeElement: null })
})

// the Templates drawer "Selected slides" apply, one history entry per selected layout slide
function applySelected(indexes: number[], templateId: string) {
    const ref = _show("active").layouts("active").ref()[0] || []
    indexes.forEach((index) => {
        const slideId = ref[index].id
        const slideSettings = getSlideSettings(slideId)
        history({ id: "slideStyle", oldData: { style: clone(slideSettings) }, newData: { style: { ...slideSettings, template: templateId } }, location: { page: "edit", show: get(activeShow)!, slide: slideId } })
    })
}

describe("selected-slides template apply", () => {
    it("marks only the selected slides and undo restores them", () => {
        applySelected([1, 3], "tpl")
        expect(own()).toEqual(["s2", "s4"])
        undo()
        undo()
        expect(own()).toEqual([])
        expect(getShowsCache().sh.slides.s2.settings).toEqual({})
    })

    it("keeps slide settings flat and keeps other settings", () => {
        setShowsCache({ sh: { ...makeShow(), slides: { ...makeShow().slides, s1: { ...makeShow().slides.s1, settings: { color: "#fff" } } } } })
        applySelected([0], "tpl")
        applySelected([0], "tpl2")
        expect(getShowsCache().sh.slides.s1.settings).toEqual({ color: "#fff", template: "tpl2" })
    })

    it("getSlideSettings returns a copy, empty when the slide has none", () => {
        expect(getSlideSettings("s1")).toEqual({})
        const settings = getSlideSettings("s1")
        settings.template = "x"
        expect(getShowsCache().sh.slides.s1.settings).toEqual({})
        expect(getSlideSettings("missing")).toEqual({})
    })

    it("marks every layout entry that points at the same slide (a repeated verse is one slide)", () => {
        const show = makeShow()
        show.layouts.L.slides = ["s1", "s1", "s1", "s2"].map((id) => ({ id }))
        setShowsCache({ sh: show })
        applySelected([0, 1], "tpl")
        expect(own()).toEqual(["s1"])
    })
})
