import { beforeEach, describe, expect, it, vi } from "vitest"

// Contract test for the Remote Web Control Protocol. Requests go in through the main-app routing entry
// (sendData) exactly as the socket delivers them; replies are read from what is sent back to the client.
// Only the edges are faked: stores, IPC to the Electron main process and the output/action helpers.

const state = vi.hoisted(() => ({
    password: "",
    outLocked: false,
    requestMainResult: vi.fn(),
    sendMain: vi.fn(),
    playMedia: vi.fn(),
    playAudio: vi.fn(),
    loadShows: vi.fn(),
    setOutput: vi.fn(),
    updateOut: vi.fn(),
    clearAll: vi.fn(),
    sent: [] as { id?: string; channel: string; data: unknown }[]
}))

vi.mock("../stores", async () => {
    const { writable } = await import("svelte/store")
    const stores: Record<string, unknown> = {}
    const names = ["actions", "actionTags", "activePage", "activeProject", "activeShow", "activeTimers", "categories", "connections", "dictionary", "folders", "language", "openedFolders", "outLocked", "overlayCategories", "overlays", "playerVideos", "projects", "remotePassword", "runningActions", "scriptures", "shows", "styles", "templateCategories", "templates", "timers", "variables", "variableTags"]
    names.forEach((name) => (stores[name] = writable({})))
    stores.showsCache = (await import("../showsCacheState/showsCache.svelte")).showsCache
    stores.connections = writable({ REMOTE: { c1: { entered: true } } })
    stores.remotePassword = writable("")
    stores.outLocked = writable(false)
    stores.activePage = writable("show")
    stores.activeTimers = writable([])
    stores.runningActions = writable([])
    stores.openedFolders = writable([])
    stores.language = writable("en")
    return stores
})
vi.mock("../components/drawer/bible/scripture", () => ({ loadJsonBible: vi.fn() }))
vi.mock("../components/helpers/array", () => ({
    clone: (value: unknown) => structuredClone(value),
    keysToID: (object: Record<string, object>) => Object.entries(object).map(([id, value]) => ({ ...value, id })),
    removeDeleted: (array: { deleted?: boolean }[]) => array.filter((item) => !item.deleted)
}))
vi.mock("../components/helpers/media", () => ({ getThumbnailPath: (path: string) => path, mediaSize: { slideSize: 0 } }))
vi.mock("../components/helpers/output", () => ({ getFirstActiveOutput: () => undefined, setOutput: state.setOutput, checkWindowCapture: vi.fn() }))
vi.mock("../components/helpers/setShow", () => ({ loadShows: state.loadShows }))
vi.mock("../components/helpers/show", () => ({ getLayoutRef: () => [] }))
vi.mock("../components/helpers/showActions", () => ({ updateOut: state.updateOut }))
vi.mock("../components/helpers/shows", () => ({ _show: vi.fn() }))
vi.mock("../components/output/clear", () => ({ clearAll: state.clearAll }))
vi.mock("../components/actions/api", () => ({ API_ACTIONS: { play_media: state.playMedia, play_audio: state.playAudio } }))
vi.mock("../IPC/main", () => ({ requestMainResult: state.requestMainResult, sendMain: state.sendMain }))
vi.mock("./common", () => ({ isMainWindow: () => true, lastClickTime: 0 }))
vi.mock("./language", () => ({ translateText: (key: string) => key }))
vi.mock("./request", () => ({ send: vi.fn() }))
vi.mock("./controllerTalk", () => ({ receiveCONTROLLER: {} }))
vi.mock("./stageTalk", () => ({ receiveSTAGE: {} }))

import { get } from "svelte/store"
import { REMOTE } from "../../types/Channels"
import { Main } from "../../types/IPC/Main"
import type { ClientMessage } from "../../types/Socket"
import { isRemoteRequestKey, REMOTE_REQUEST_KEYS, toRemoteReplayRequest, type RemoteProtocol, type RemoteRequestKey, type RemoteResponseKey, type RemoteResponses } from "../../types/remote/protocol"
import type { WebSendArgs } from "../../types/WebProtocol"
import { setShowsCache } from "../showsCacheState/showsCache.svelte"
import { activePage, activeProject, activeShow, connections, outLocked, projects, remotePassword, shows } from "../stores"
import { receiveREMOTE } from "./remoteTalk"
import { sendData } from "./sendData"

type Reply = { id?: string; channel: string; data: unknown }

/** send one protocol request as connection `c1`; payload types come from the protocol */
async function request<K extends RemoteRequestKey>(channel: K, ...args: WebSendArgs<RemoteProtocol, K>) {
    await sendData(REMOTE, { id: "c1", channel, data: args[0] ?? null } as ClientMessage)
}
function replies<C extends RemoteResponseKey>(channel: C): { id?: string; channel: C; data: RemoteResponses[C] }[] {
    return state.sent.filter((message) => message.channel === channel) as never
}
function only<C extends RemoteResponseKey>(channel: C) {
    const found = replies(channel)
    expect(found).toHaveLength(1)
    return found[0]
}

beforeEach(() => {
    state.sent = []
    state.requestMainResult.mockReset()
    state.sendMain.mockReset()
    state.playMedia.mockReset()
    state.playAudio.mockReset()
    state.loadShows.mockReset()
    state.setOutput.mockReset()
    state.updateOut.mockReset()
    state.clearAll.mockReset()
    ;(globalThis as { window?: unknown }).window = { api: { send: (_id: string, message: Reply) => state.sent.push(message) } }
    connections.set({ REMOTE: { c1: { entered: true } } } as never)
    remotePassword.set("")
    outLocked.set(false)
})

describe("protocol shape", () => {
    it("has a main-app handler for every request key and no others", () => {
        expect(Object.keys(receiveREMOTE).sort()).toEqual([...REMOTE_REQUEST_KEYS].sort())
        expect(isRemoteRequestKey("MEDIA_PLAY")).toBe(true)
        expect(isRemoteRequestKey("_remoteMediaOperation")).toBe(false)
    })
})

describe("handlers reply with protocol messages", () => {
    it("MEDIA_THUMBNAIL and MEDIA_PLAY handlers return their final reply, not an operation marker", async () => {
        state.requestMainResult.mockImplementation((channel: unknown) => Promise.resolve(channel === Main.REMOTE_MEDIA_THUMBNAIL ? { status: "success", data: { path: "/m/a.png", thumbnail: "T" } } : { status: "success", data: { path: "/m/a.png", kind: "image", size: 1, modifiedAt: 1 } }))
        const thumbnail = await receiveREMOTE.MEDIA_THUMBNAIL({ id: "c1", channel: "MEDIA_THUMBNAIL", data: { requestId: "x", path: "/m/a.png" } })
        const play = await receiveREMOTE.MEDIA_PLAY({ id: "c1", channel: "MEDIA_PLAY", data: { requestId: "y", path: "/m/a.png" } })
        expect(thumbnail).toEqual({ id: "c1", channel: "MEDIA_THUMBNAIL_RESULT", data: { requestId: "x", path: "/m/a.png", thumbnail: "T" } })
        expect(play).toEqual({ id: "c1", channel: "MEDIA_PLAY_RESULT", data: { requestId: "y", ok: true } })
    })
})

describe("media list", () => {
    it("answers the first page with MEDIA_PAGE for the same request", async () => {
        const page = { requestId: "r1", path: "", parentPath: "", page: 0, items: [{ path: "/m/a.png", name: "a.png", kind: "image" as const, size: 1, modifiedAt: 2 }], nextCursor: null, hasMore: false }
        state.requestMainResult.mockResolvedValue({ status: "success", data: page })

        await request("MEDIA_LIST", { requestId: "r1", path: "", page: 0 })

        expect(state.requestMainResult).toHaveBeenCalledWith(Main.REMOTE_MEDIA_PAGE, { requestId: "r1", path: "", page: 0, connectionId: "c1" }, expect.anything())
        expect(only("MEDIA_PAGE")).toMatchObject({ id: "c1", data: page })
    })

    it("maps a main-process failure to a MEDIA_ERROR code", async () => {
        state.requestMainResult.mockResolvedValue({ status: "error", error: { message: "invalid_path: outside roots" } })
        await request("MEDIA_LIST", { requestId: "r2", path: "/etc", page: 0 })
        expect(only("MEDIA_ERROR")).toMatchObject({ id: "c1", data: { requestId: "r2", code: "invalid_path" } })
    })

    it("rejects a continuation page that has no open view", async () => {
        await request("MEDIA_LIST", { requestId: "gone", path: "", page: 1 })
        expect(only("MEDIA_ERROR").data).toEqual({ requestId: "gone", code: "cursor_expired" })
    })
})

describe("media cancel", () => {
    it("aborts the pending page request, closes the view and sends no reply", async () => {
        let signal!: AbortSignal
        state.requestMainResult.mockImplementation((_channel: unknown, _data: unknown, options: { signal: AbortSignal }) => {
            signal = options.signal
            return new Promise(() => undefined)
        })
        void request("MEDIA_LIST", { requestId: "r3", path: "", page: 0 })
        await vi.waitFor(() => expect(signal).toBeDefined())

        await request("MEDIA_CANCEL", { requestId: "r3" })

        expect(signal.aborted).toBe(true)
        expect(state.sendMain).toHaveBeenCalledWith(Main.REMOTE_MEDIA_CLOSE, { connectionId: "c1" })
        expect(state.sent).toEqual([])
    })
})

describe("media thumbnail", () => {
    it("answers MEDIA_THUMBNAIL_RESULT carrying the request id", async () => {
        state.requestMainResult.mockResolvedValue({ status: "success", data: { path: "/m/a.png", thumbnail: "data:image/png;base64,AA" } })
        await request("MEDIA_THUMBNAIL", { requestId: "t1", path: "/m/a.png" })
        expect(state.requestMainResult).toHaveBeenCalledWith(Main.REMOTE_MEDIA_THUMBNAIL, { connectionId: "c1", path: "/m/a.png" })
        expect(only("MEDIA_THUMBNAIL_RESULT")).toMatchObject({ id: "c1", data: { requestId: "t1", path: "/m/a.png", thumbnail: "data:image/png;base64,AA" } })
    })

    it("answers MEDIA_ERROR when the thumbnail is too large", async () => {
        state.requestMainResult.mockResolvedValue({ status: "error", error: { message: "too_large" } })
        await request("MEDIA_THUMBNAIL", { requestId: "t2", path: "/m/huge.png" })
        expect(only("MEDIA_ERROR").data).toEqual({ requestId: "t2", code: "too_large" })
    })

    it("sends nothing when the connection is not authorized", async () => {
        connections.set({ REMOTE: { c1: { entered: false } } } as never)
        await request("MEDIA_THUMBNAIL", { requestId: "t3", path: "/m/a.png" })
        expect(state.sent).toEqual([])
        expect(state.requestMainResult).not.toHaveBeenCalled()
    })
})

describe("media play", () => {
    it("plays validated video with loop and mute options and answers ok", async () => {
        state.requestMainResult.mockResolvedValue({ status: "success", data: { path: "/m/clip.mp4", kind: "video", size: 1, modifiedAt: 1 } })
        await request("MEDIA_PLAY", { requestId: "p1", path: "/requested/clip.mp4", loop: true, muted: false })
        expect(state.requestMainResult).toHaveBeenCalledWith(Main.REMOTE_MEDIA_RESOLVE, { connectionId: "c1", path: "/requested/clip.mp4" })
        expect(state.playMedia).toHaveBeenCalledWith({ path: "/m/clip.mp4", data: { type: "video", loop: true, muted: false } })
        expect(only("MEDIA_PLAY_RESULT")).toMatchObject({ id: "c1", data: { requestId: "p1", ok: true } })
    })

    it("routes audio through the audio action", async () => {
        state.requestMainResult.mockResolvedValue({ status: "success", data: { path: "/m/song.mp3", kind: "audio", size: 1, modifiedAt: 1 } })
        await request("MEDIA_PLAY", { requestId: "p2", path: "/m/song.mp3" })
        expect(state.playAudio).toHaveBeenCalledWith({ path: "/m/song.mp3" })
        expect(state.playMedia).not.toHaveBeenCalled()
        expect(only("MEDIA_PLAY_RESULT").data).toEqual({ requestId: "p2", ok: true })
    })

    it("refuses with unavailable while the output is locked", async () => {
        state.requestMainResult.mockResolvedValue({ status: "success", data: { path: "/m/clip.mp4", kind: "video", size: 1, modifiedAt: 1 } })
        outLocked.set(true)
        await request("MEDIA_PLAY", { requestId: "p3", path: "/m/clip.mp4" })
        expect(state.playMedia).not.toHaveBeenCalled()
        expect(only("MEDIA_PLAY_RESULT").data).toEqual({ requestId: "p3", ok: false, code: "unavailable" })
    })

    it("reports a rejected path without playing", async () => {
        state.requestMainResult.mockResolvedValue({ status: "error", error: { message: "not_media" } })
        await request("MEDIA_PLAY", { requestId: "p4", path: "/m/notes.txt" })
        expect(state.playMedia).not.toHaveBeenCalled()
        expect(only("MEDIA_PLAY_RESULT").data).toEqual({ requestId: "p4", ok: false, code: "not_media" })
    })

    it("does not play when the remote is revoked during path validation", async () => {
        let finish!: (result: unknown) => void
        state.requestMainResult.mockReturnValue(new Promise((resolve) => (finish = resolve)))
        const pending = request("MEDIA_PLAY", { requestId: "p5", path: "/m/clip.mp4" })
        connections.set({ REMOTE: { c1: { entered: false } } } as never)
        finish({ status: "success", data: { path: "/m/clip.mp4", kind: "video", size: 1, modifiedAt: 1 } })
        await pending
        expect(state.playMedia).not.toHaveBeenCalled()
        expect(state.sent).toEqual([])
    })
})

describe("access, show and project messages", () => {
    it("PASSWORD asks for a password when one is set", async () => {
        remotePassword.set("secret")
        connections.set({ REMOTE: { c1: {} } } as never)
        await request("PASSWORD")
        expect(only("PASSWORD").data).toMatchObject({ password: true })
        expect(get(connections).REMOTE.c1.entered).toBeFalsy()
    })

    it("ACCESS with a wrong password answers ERROR wrongPass", async () => {
        remotePassword.set("secret")
        connections.set({ REMOTE: { c1: {} } } as never)
        await request("ACCESS", "nope")
        expect(only("ERROR").data).toBe("wrongPass")
    })

    it("ACCESS with the right password enters the connection and answers SHOWS", async () => {
        remotePassword.set("secret")
        connections.set({ REMOTE: { c1: {} } } as never)
        shows.set({ s1: { name: "Song", category: null, timestamps: { created: 0, modified: null, used: null } } } as never)
        await request("ACCESS", "secret")
        expect(get(connections).REMOTE.c1.entered).toBe(true)
        expect(replies("SHOWS")[0].data).toHaveProperty("s1")
    })

    it("ignores protected requests from a connection that has not entered", async () => {
        remotePassword.set("secret")
        connections.set({ REMOTE: { c1: {} } } as never)
        await request("PROJECTS")
        expect(state.sent).toEqual([])
    })

    it("SHOW answers the loaded show with its id", async () => {
        const show = { name: "Song", settings: { activeLayout: "default" }, media: {}, slides: {}, layouts: { default: { slides: [] } } }
        setShowsCache({ s1: show } as never)
        shows.set({ s1: { name: "Song" } } as never)
        await request("SHOW", "s1")
        expect(state.loadShows).toHaveBeenCalledWith(["s1"])
        expect(only("SHOW")).toMatchObject({ id: "c1", data: { id: "s1", name: "Song" } })
    })

    it("PROJECTS answers the project list with ids", async () => {
        projects.set({ p1: { name: "Sunday", created: 1, parent: "/", shows: [{ id: "s1", type: "show" }] } } as never)
        await request("PROJECTS")
        expect(only("PROJECTS").data).toMatchObject([{ id: "p1", name: "Sunday" }])
    })

    it("ignores an unknown channel", async () => {
        await sendData(REMOTE, { id: "c1", channel: "_remoteMediaOperation", data: { x: 1 } } as unknown as ClientMessage)
        expect(state.sent).toEqual([])
    })
})

describe("reconnect replay never changes operator state", () => {
    // everything a Remote may have asked for before a reconnect, with a representative payload
    const earlierRequests: [string, unknown][] = [
        ["SHOW", "s1"],
        ["OUT", null],
        ["OUT", 3],
        ["OUT", "clear"],
        ["OUT", { id: "s1", index: 0 }],
        ["OUT_DATA", null],
        ["GET_FUNCTIONS", null],
        ["GET_OVERLAYS", null],
        ["GET_TEMPLATES", null],
        ["GET_SCRIPTURE", { id: "b1" }],
        ["SEARCH_SCRIPTURE", { id: "b1", searchTerm: "x" }],
        ["MEDIA_LIST", { requestId: "r", path: "", page: 0 }],
        ["MEDIA_THUMBNAIL", { requestId: "r", path: "/m/a.png" }],
        ["MEDIA_PLAY", { requestId: "r", path: "/m/a.png" }],
        ["PASSWORD", null],
        ["ACCESS", "secret"]
    ]

    function seed() {
        const show = { name: "Song", settings: { activeLayout: "default" }, media: {}, slides: {}, layouts: { default: { slides: [] } } }
        setShowsCache({ s1: show } as never)
        shows.set({ s1: { name: "Song" } } as never)
        activePage.set("show" as never)
        activeShow.set({ id: "operator-show" } as never)
        activeProject.set("operator-project" as never)
    }
    const operatorState = () => ({ activeShow: get(activeShow), activeProject: get(activeProject), activePage: get(activePage), outLocked: get(outLocked) })

    it("sends only side-effect-free reads, and the handlers of those reads leave operator state alone", async () => {
        seed()
        const before = operatorState()
        const replayed = earlierRequests.map(([channel, data]) => toRemoteReplayRequest(channel, data)).filter((message) => message !== null)

        // only state queries and the read-only show twin come back; live actions and the opening SHOW do not
        expect(replayed.map((message) => message.channel).sort()).toEqual(["GET_FUNCTIONS", "GET_OVERLAYS", "GET_SHOW", "GET_TEMPLATES", "OUT", "OUT_DATA"])
        expect(replayed.find((message) => message.channel === "OUT")?.data).toBeNull()

        for (const message of replayed) {
            await sendData(REMOTE, { id: "c1", channel: message.channel, data: message.data } as ClientMessage)
        }

        expect(replayed.length).toBeGreaterThan(0)
        expect(only("SHOW").data).toMatchObject({ id: "s1", name: "Song" })
        expect(operatorState()).toEqual(before)
        expect(state.setOutput).not.toHaveBeenCalled()
        expect(state.updateOut).not.toHaveBeenCalled()
        expect(state.clearAll).not.toHaveBeenCalled()
        expect(state.sendMain).not.toHaveBeenCalled()
        expect(state.requestMainResult).not.toHaveBeenCalled()
    })

    it("is sensitive to the mutation it guards against: a plain SHOW does open the show", async () => {
        seed()
        await request("SHOW", "s1")
        expect(get(activeShow)).toEqual({ id: "s1" })
    })

    it("does not replay a request unknown to the protocol", () => {
        expect(toRemoteReplayRequest("RUN_ACTION", { id: "x" })).toBeNull()
    })
})
