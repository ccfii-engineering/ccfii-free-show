import type { Writable } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"

// A rendered import (PowerPoint/PDF) has empty slides: the page image is the layout slide's background media. The
// Controller preview can only show it if the snapshot lists that media as a preview asset.

const state = vi.hoisted(() => ({
    show: null as any,
    ref: [] as any[]
}))

vi.mock("../stores", async () => {
    const { writable } = await import("svelte/store")
    return {
        activeFocus: writable({}),
        activeProject: writable(null),
        activeShow: writable(null),
        connections: writable({ CONTROLLER: { c1: {} } }),
        draw: writable(null),
        drawSettings: writable({}),
        drawTool: writable("focus"),
        focusMode: writable(false),
        outputSlideCache: writable({}),
        outputs: writable({}),
        paintCache: writable([]),
        projects: writable({}),
        serverData: writable({}),
        showsCache: writable({ show1: state.show }),
        special: writable({}),
        styles: writable({})
    }
})
vi.mock("../components/helpers/output", () => ({
    defaultLayers: ["background", "slide", "overlays"],
    getFirstActiveOutput: () => ({ id: "out1", out: { slide: { id: "show1", index: 0, layout: "layout1" } } }),
    getFirstOutput: () => ({ id: "out1" }),
    getOutputResolution: () => ({ width: 1920, height: 1080 })
}))
vi.mock("../components/helpers/OutputHelper", () => ({ OutputHelper: { advanceOutputs: vi.fn(), getPresenterNext: () => ({ id: "show1", index: 1, layout: "layout1" }) } }))
vi.mock("../components/helpers/shows", () => ({
    _show: () => ({
        layouts: () => ({ ref: () => [state.ref] }),
        slides: (ids: string[]) => ({ get: () => ids.map((id) => state.show.slides[id]) })
    })
}))
vi.mock("../components/output/clear", () => ({ clearAll: vi.fn(), clearSlide: vi.fn() }))
vi.mock("../components/helpers/array", () => ({ clone: (value: unknown) => structuredClone(value) }))
vi.mock("../IPC/main", () => ({ requestMainResult: vi.fn() }))

import { showsCache } from "../stores"
import { receiveCONTROLLER } from "./controllerTalk"

beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = { api: { send: vi.fn() } }
    // layout refs as built by helpers/shows.ts: the background media id sits under `data`
    state.show = {
        name: "AMEN",
        settings: { activeLayout: "layout1" },
        slides: {
            s1: { group: ".", color: "", settings: {}, notes: "", items: [], children: ["s2"] },
            s2: { group: null, color: null, settings: {}, notes: "", items: [] }
        },
        media: {
            bg1: { path: "/imports/amen/page-1.png", name: "page-1" },
            bg2: { path: "/imports/amen/page-2.png", name: "page-2" }
        },
        layouts: {}
    }
    state.ref = [
        { type: "parent", layoutId: "layout1", index: 0, layoutIndex: 0, id: "s1", children: ["s2"], data: { id: "s1", background: "bg1", children: { s2: { background: "bg2" } } } },
        { type: "child", layoutId: "layout1", index: 0, layoutIndex: 1, id: "s2", parent: { id: "s1" }, data: { background: "bg2" } }
    ]
    ;(showsCache as unknown as Writable<Record<string, unknown>>).set({ show1: state.show })
})

describe("controller presenter snapshot for rendered imports", () => {
    it("lists the background page image of the current and next slide as preview assets", async () => {
        const reply: any = await receiveCONTROLLER.PRESENTER_SUBSCRIBE({ id: "c1", channel: "PRESENTER_SUBSCRIBE", data: null })
        const snapshot = reply.data

        expect(snapshot.current.layoutSlide.data.background).toBe("bg1")
        expect(snapshot.current.media).toEqual({ bg1: { path: "/imports/amen/page-1.png" } })
        expect(Object.keys(snapshot.current.assets)).toEqual(["/imports/amen/page-1.png"])
        expect(Object.keys(snapshot.next.assets)).toEqual(["/imports/amen/page-2.png"])
    })
})
