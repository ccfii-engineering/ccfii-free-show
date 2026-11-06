import { beforeEach, describe, expect, it, vi } from "vitest"

// `API:set_template` from the Remote goes through sendData into applyRemoteTemplate.
// Only the edges are faked: stores, profile access, history and the show helpers.

const state = vi.hoisted(() => ({
    connections: { REMOTE: { c1: { entered: true } } } as Record<string, any>,
    remotePassword: "",
    activeShow: { id: "desktop-show" },
    templates: { t1: { name: "Lower third" } } as Record<string, any>,
    categories: {} as Record<string, any>,
    showsCache: {} as Record<string, any>,
    access: {} as Record<string, any>,
    layoutRef: [{ id: "a" }, { id: "b" }, { id: "c" }] as { id: string }[],
    lockedSlides: [] as string[],
    history: vi.fn(),
    loadShows: vi.fn(),
    sent: [] as any[]
}))

vi.mock("../stores", () => {
    const store = (key: "connections" | "remotePassword" | "activeShow" | "templates" | "categories") => ({
        subscribe(run: (value: any) => void) {
            run(state[key])
            return () => undefined
        }
    })
    return { connections: store("connections"), remotePassword: store("remotePassword"), activeShow: store("activeShow"), templates: store("templates"), categories: store("categories"), outLocked: { subscribe: (run: (v: boolean) => void) => (run(false), () => undefined) }, shows: store("connections") }
})
vi.mock("../showsCacheState/showsCache.svelte", () => ({ showsCache: { subscribe: (run: (value: any) => void) => (run(state.showsCache), () => undefined) } }))
vi.mock("./profile", () => ({ getAccess: () => state.access }))
vi.mock("../components/helpers/history", () => ({ history: state.history }))
vi.mock("../components/helpers/setShow", () => ({ loadShows: state.loadShows }))
vi.mock("../components/helpers/show", () => ({ getLayoutRef: () => state.layoutRef, isSlideLocked: (_show: string, id: string) => state.lockedSlides.includes(id) }))
vi.mock("../components/actions/api", async () => {
    const { applyRemoteTemplate } = await import("./remoteTemplate")
    return { API_ACTIONS: { set_template: applyRemoteTemplate } }
})
vi.mock("../components/helpers/output", () => ({ checkWindowCapture: vi.fn() }))
vi.mock("../IPC/main", () => ({ requestMainResult: vi.fn() }))
vi.mock("./common", () => ({ isMainWindow: () => true }))
vi.mock("./controllerTalk", () => ({ receiveCONTROLLER: {} }))
vi.mock("./remoteTalk", () => ({ receiveREMOTE: {}, closeRemoteMediaConnection: vi.fn() }))
vi.mock("./stageTalk", () => ({ receiveSTAGE: {} }))

import { REMOTE } from "../../types/Channels"
import { sendData } from "./sendData"

const message = (data: unknown, id = "c1") => ({ id, channel: "API:set_template", data }) as any
const reply = () => state.sent.find((m) => m.channel === "API:set_template")

beforeEach(() => {
    state.connections = { REMOTE: { c1: { entered: true } } }
    state.remotePassword = ""
    state.activeShow = { id: "desktop-show" }
    state.categories = {}
    state.access = {}
    state.lockedSlides = []
    state.showsCache = { ipad: { name: "iPad show", category: "cat" }, desktop: { name: "Desktop show" }, "desktop-show": { name: "Desktop show" } }
    state.history.mockReset()
    state.loadShows.mockReset()
    state.sent = []
    ;(globalThis as any).window = { api: { send: (_id: string, m: unknown) => state.sent.push(m) } }
})

describe("API:set_template from the Remote", () => {
    it("applies to the whole show named in the request, not the desktop's active show", async () => {
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "show" }))

        expect(state.history).toHaveBeenCalledTimes(1)
        expect(state.history.mock.calls[0][0]).toMatchObject({ id: "TEMPLATE", newData: { id: "t1" }, location: { override: "show#ipad" } })
        expect(reply()).toMatchObject({ id: "c1", data: { status: "applied", showId: "ipad", scope: "show", count: 3 } })
    })

    it("applies to the selected slide indexes as one history step and skips locked slides", async () => {
        state.lockedSlides = ["b"]
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "slides", slides: [0, 1, 2, 2, 9] }))

        expect(state.history).toHaveBeenCalledTimes(1)
        expect(state.history.mock.calls[0][0]).toMatchObject({ id: "slideTemplate", newData: { template: "t1", slideIds: ["a", "c"] }, location: { show: { id: "ipad" } } })
        expect(reply().data).toEqual({ status: "applied", showId: "ipad", scope: "slides", count: 2 })
    })

    it("keeps old callers working: only an id applies to the active show as a whole show", async () => {
        await sendData(REMOTE, message({ id: "t1" }))

        expect(state.history.mock.calls[0][0]).toMatchObject({ id: "TEMPLATE", location: { override: "show#desktop-show" } })
        expect(reply().data).toMatchObject({ status: "applied", showId: "desktop-show", scope: "show" })
    })

    it.each([
        ["show_locked", () => (state.showsCache.ipad.locked = true)],
        ["read_only", () => (state.access = { global: "read" })],
        ["category_template", () => (state.categories = { cat: { template: "t1" } })]
    ])("replies blocked (%s) and changes nothing", async (reason, arrange) => {
        arrange()
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "show" }))

        expect(state.history).not.toHaveBeenCalled()
        expect(reply().data).toEqual({ status: "blocked", reason, showId: "ipad" })
    })

    it("a read-only category profile blocks too", async () => {
        state.access = { cat: "read" }
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "slides", slides: [0] }))

        expect(reply().data).toMatchObject({ status: "blocked", reason: "read_only" })
    })

    it("a category template blocks the whole show only; selected slides still apply", async () => {
        state.categories = { cat: { template: "t1" } }
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "slides", slides: [1] }))

        expect(state.history).toHaveBeenCalledTimes(1)
        expect(reply().data).toMatchObject({ status: "applied", scope: "slides", count: 1 })
    })

    it("blocks a show lock for selected slides too", async () => {
        state.showsCache.ipad.locked = true
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "slides", slides: [1] }))

        expect(reply().data).toMatchObject({ status: "blocked", reason: "show_locked" })
    })

    it("replies blocked for an unknown show, an unknown template and slides that cannot take it", async () => {
        await sendData(REMOTE, message({ id: "t1", showId: "missing", scope: "show" }))
        expect(reply().data).toMatchObject({ status: "blocked", reason: "no_show" })

        state.sent = []
        await sendData(REMOTE, message({ id: "gone", showId: "ipad" }))
        expect(reply().data).toMatchObject({ status: "blocked", reason: "unknown_template" })

        state.sent = []
        state.lockedSlides = ["a"]
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "slides", slides: [0] }))
        expect(reply().data).toMatchObject({ status: "blocked", reason: "no_slides" })
        expect(state.history).not.toHaveBeenCalled()
    })

    it("answers nothing and applies nothing for a connection that has not been let in", async () => {
        state.connections = { REMOTE: { c1: { entered: false } } }
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "show" }))
        expect(state.history).not.toHaveBeenCalled()
        expect(state.sent).toEqual([])

        // an unknown connection, with a password set, is refused the same way
        state.connections = { REMOTE: {} }
        state.remotePassword = "secret"
        await sendData(REMOTE, message({ id: "t1", showId: "ipad", scope: "show" }, "stranger"))
        expect(state.history).not.toHaveBeenCalled()
        expect(state.sent).toEqual([])
    })
})
