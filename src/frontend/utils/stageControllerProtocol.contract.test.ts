import { beforeEach, describe, expect, it, vi } from "vitest"

// Routing contract for the Stage and Controller protocols: requests enter through sendData exactly as the socket
// delivers them; replies are read from what is sent back to the client.

const state = vi.hoisted(() => ({
    sent: [] as { id?: string; channel: string; data: unknown; listenerId?: string }[],
    stage: {} as Record<string, (msg: any) => unknown>,
    controller: {} as Record<string, (msg: any) => unknown>
}))

vi.mock("../stores", async () => {
    const { writable } = await import("svelte/store")
    return { connections: writable({ STAGE: { s1: {} }, CONTROLLER: { c1: {} } }), outLocked: writable(false), remotePassword: writable(""), shows: writable({}) }
})
vi.mock("../components/actions/api", () => ({ API_ACTIONS: {} }))
vi.mock("../components/helpers/output", () => ({ checkWindowCapture: vi.fn() }))
vi.mock("../IPC/main", () => ({ requestMainResult: vi.fn() }))
vi.mock("./common", () => ({ isMainWindow: () => true }))
vi.mock("./controllerTalk", () => ({ receiveCONTROLLER: state.controller }))
vi.mock("./remoteTalk", () => ({ receiveREMOTE: {}, closeRemoteMediaConnection: vi.fn() }))
vi.mock("./stageTalk", () => ({ receiveSTAGE: state.stage }))

import { CONTROLLER, STAGE } from "../../types/Channels"
import { CONTROLLER_REQUEST_KEYS, isControllerRequestKey } from "../../types/controller/protocol"
import { isStageRequestKey, STAGE_REQUEST_KEYS, toStageReplayRequest } from "../../types/stage/protocol"
import type { ClientMessage } from "../../types/Socket"
import { sendData } from "./sendData"

beforeEach(() => {
    state.sent = []
    Object.keys(state.stage).forEach((key) => delete state.stage[key])
    Object.keys(state.controller).forEach((key) => delete state.controller[key])
    ;(globalThis as { window?: unknown }).window = { api: { send: (_id: string, message: (typeof state.sent)[number]) => state.sent.push(message) } }
})

describe("protocol keys", () => {
    it("lists the requests each app can send", () => {
        expect([...STAGE_REQUEST_KEYS].sort()).toEqual(["LAYOUT", "LAYOUTS", "OUT", "REQUEST_PROGRESS", "RUN_ACTION", "SHOW_DATA", "STREAM_SUBSCRIBE", "STREAM_UNSUBSCRIBE"])
        expect([...CONTROLLER_REQUEST_KEYS].sort()).toEqual(["ACTION", "FOCUS", "GET_OUTPUT_ID", "PRESENTER_SUBSCRIBE", "PRESENTER_THUMBNAIL", "PRESENTER_UNSUBSCRIBE"])
        expect(isStageRequestKey("toString")).toBe(false)
        expect(isControllerRequestKey("OUTPUT_FRAME")).toBe(false)
    })
})

describe("Stage reconnect replay", () => {
    it("replays only the reads that push data to the asking client; layout and live actions are never replayed", () => {
        const replayed = STAGE_REQUEST_KEYS.filter((key) => toStageReplayRequest(key, null))
        expect(replayed.sort()).toEqual(["OUT", "REQUEST_PROGRESS", "SHOW_DATA"])
        expect(toStageReplayRequest("RUN_ACTION", { id: "a" })).toBeNull()
        expect(toStageReplayRequest("LAYOUT", { id: "a" })).toBeNull()
    })
})

describe("Stage routing", () => {
    it("hands the handler the connection id and keeps the asker's id and listenerId on the reply", async () => {
        const handler = vi.fn((msg: { id: string; data: unknown }) => ({ id: msg.id, channel: "LAYOUTS", data: [{ id: "a", name: "A", password: false }] }))
        state.stage.LAYOUTS = handler

        await sendData(STAGE, { id: "s1", channel: "LAYOUTS", data: null, listenerId: "L1" } as unknown as ClientMessage)

        expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", channel: "LAYOUTS" }))
        expect(state.sent).toEqual([{ id: "s1", channel: "LAYOUTS", data: [{ id: "a", name: "A", password: false }], listenerId: "L1" }])
    })

    it("answers with the reply channel the handler chose (ERROR for a wrong password)", async () => {
        state.stage.LAYOUT = (msg: { id: string }) => ({ id: msg.id, channel: "ERROR", data: "wrongPass" })
        await sendData(STAGE, { id: "s1", channel: "LAYOUT", data: { id: "x", password: "no" } } as unknown as ClientMessage)
        expect(state.sent).toMatchObject([{ id: "s1", channel: "ERROR", data: "wrongPass" }])
    })

    it("app-internal requests use the first connection for the handler but broadcast the reply", async () => {
        const handler = vi.fn(() => ({ channel: "OUT", data: { id: "o" } }))
        state.stage.OUT = handler
        await sendData(STAGE, { channel: "OUT" } as unknown as ClientMessage)
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }))
        expect(state.sent).toHaveLength(1)
        expect(state.sent[0].id).toBeUndefined()
    })

    it("sends nothing for a handler without a reply and ignores unknown channels", async () => {
        state.stage.STREAM_UNSUBSCRIBE = () => undefined
        await sendData(STAGE, { id: "s1", channel: "STREAM_UNSUBSCRIBE" } as unknown as ClientMessage)
        await sendData(STAGE, { id: "s1", channel: "NOPE" } as unknown as ClientMessage)
        expect(state.sent).toEqual([])
    })
})

describe("Controller routing", () => {
    it("sends the handler reply to the controller connection that asked", async () => {
        state.controller.GET_OUTPUT_ID = (msg: { id: string }) => ({ id: msg.id, channel: "GET_OUTPUT_ID", data: "out1" })
        await sendData(CONTROLLER, { id: "c1", channel: "GET_OUTPUT_ID" } as unknown as ClientMessage)
        expect(state.sent).toEqual([{ id: "c1", channel: "GET_OUTPUT_ID", data: "out1" }])
    })

    it("drops replies for a controller that disconnected while the handler ran", async () => {
        state.controller.GET_OUTPUT_ID = () => ({ id: "gone", channel: "GET_OUTPUT_ID", data: "out1" })
        await sendData(CONTROLLER, { id: "c1", channel: "GET_OUTPUT_ID" } as unknown as ClientMessage)
        expect(state.sent).toEqual([])
    })

    it("ignores channels outside the protocol (OUTPUT_FRAME is answered by the Electron server layer)", async () => {
        await sendData(CONTROLLER, { id: "c1", channel: "OUTPUT_FRAME", data: { outputId: "x" } } as unknown as ClientMessage)
        expect(state.sent).toEqual([])
    })
})
