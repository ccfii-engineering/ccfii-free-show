import { beforeEach, describe, expect, it, vi } from "vitest"

// `API:set_plain_text` from the Remote goes through sendData into saveRemoteText.
// Only the edges are faked: stores, profile access, the show loader and the text formatter.

const state = vi.hoisted(() => ({
    connections: { REMOTE: { c1: { entered: true } } } as Record<string, any>,
    remotePassword: "",
    activeShow: { id: "desktop-show" } as any,
    showsCache: {} as Record<string, any>,
    access: {} as Record<string, any>,
    formatText: vi.fn(),
    loadShows: vi.fn(),
    sent: [] as any[]
}))

vi.mock("../stores", () => {
    const store = (key: "connections" | "remotePassword" | "activeShow") => ({
        subscribe(run: (value: any) => void) {
            run(state[key])
            return () => undefined
        }
    })
    return { connections: store("connections"), remotePassword: store("remotePassword"), activeShow: store("activeShow"), outLocked: { subscribe: (run: (v: boolean) => void) => (run(false), () => undefined) }, shows: store("connections") }
})
vi.mock("../showsCacheState/showsCache.svelte", () => ({ showsCache: { subscribe: (run: (value: any) => void) => (run(state.showsCache), () => undefined) } }))
vi.mock("./profile", () => ({ getAccess: () => state.access }))
vi.mock("../components/helpers/setShow", () => ({ loadShows: state.loadShows }))
vi.mock("../components/show/formatTextEditor", () => ({ formatText: state.formatText }))
vi.mock("../components/actions/api", async () => {
    const { saveRemoteText } = await import("./remoteText")
    return { API_ACTIONS: { set_plain_text: saveRemoteText } }
})
vi.mock("../components/helpers/output", () => ({ checkWindowCapture: vi.fn() }))
vi.mock("../IPC/main", () => ({ requestMainResult: vi.fn() }))
vi.mock("./common", () => ({ isMainWindow: () => true }))
vi.mock("./controllerTalk", () => ({ receiveCONTROLLER: {} }))
vi.mock("./remoteTalk", () => ({ receiveREMOTE: {}, closeRemoteMediaConnection: vi.fn() }))
vi.mock("./stageTalk", () => ({ receiveSTAGE: {} }))

import { REMOTE } from "../../types/Channels"
import { sendData } from "./sendData"

const message = (data: unknown, id = "c1") => ({ id, channel: "API:set_plain_text", data }) as any
const reply = () => state.sent.find((m) => m.channel === "API:set_plain_text")
const text = "[Verse 1]\nLine one\n\n[Chorus]\nLine two"

beforeEach(() => {
    state.connections = { REMOTE: { c1: { entered: true } } }
    state.remotePassword = ""
    state.activeShow = { id: "desktop-show" }
    state.access = {}
    state.showsCache = { ipad: { name: "iPad show", category: "cat", slides: { a: {}, b: {} } }, "desktop-show": { name: "Desktop show", slides: {} } }
    state.formatText.mockReset()
    state.loadShows.mockReset()
    state.sent = []
    ;(globalThis as any).window = { api: { send: (_id: string, m: unknown) => state.sent.push(m) } }
})

describe("API:set_plain_text from the Remote", () => {
    it("saves the text into the show named in the request and replies saved", async () => {
        await sendData(REMOTE, message({ id: "ipad", value: text }))

        expect(state.loadShows).toHaveBeenCalledWith(["ipad"])
        expect(state.formatText).toHaveBeenCalledWith(text, "ipad")
        expect(reply()).toMatchObject({ id: "c1", data: { status: "saved", showId: "ipad" } })
    })

    it("saves an emptied text too", async () => {
        await sendData(REMOTE, message({ id: "ipad", value: "" }))

        expect(state.formatText).toHaveBeenCalledWith("", "ipad")
        expect(reply().data).toEqual({ status: "saved", showId: "ipad" })
    })

    it("keeps old callers working: without an id the active show is used", async () => {
        await sendData(REMOTE, message({ value: text }))

        expect(state.formatText).toHaveBeenCalledWith(text, "desktop-show")
        expect(reply().data).toEqual({ status: "saved", showId: "desktop-show" })
    })

    it.each([
        ["show_locked", () => (state.showsCache.ipad.locked = true)],
        ["slide_locked", () => (state.showsCache.ipad.slides.b.locked = true)],
        ["read_only", () => (state.access = { global: "read" })]
    ])("refuses a save for a %s show, changes nothing and tells the Remote why", async (reason, arrange) => {
        arrange()
        await sendData(REMOTE, message({ id: "ipad", value: text }))

        expect(state.formatText).not.toHaveBeenCalled()
        expect(reply().data).toEqual({ status: "blocked", reason, showId: "ipad" })
    })

    it("a read-only category profile refuses too", async () => {
        state.access = { cat: "read" }
        await sendData(REMOTE, message({ id: "ipad", value: text }))

        expect(state.formatText).not.toHaveBeenCalled()
        expect(reply().data).toMatchObject({ status: "blocked", reason: "read_only" })
    })

    it("refuses a show that does not exist on the main app", async () => {
        await sendData(REMOTE, message({ id: "gone", value: text }))

        expect(state.formatText).not.toHaveBeenCalled()
        expect(reply().data).toEqual({ status: "blocked", reason: "no_show", showId: "gone" })
    })

    it("saves nothing and sends nothing when the connection is not authorized", async () => {
        state.connections = { REMOTE: { c1: { entered: false } } }
        await sendData(REMOTE, message({ id: "ipad", value: text }))

        expect(state.formatText).not.toHaveBeenCalled()
        expect(state.sent).toEqual([])
    })
})
