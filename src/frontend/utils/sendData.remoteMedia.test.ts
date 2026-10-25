import { beforeEach, describe, expect, it, vi } from "vitest"

const testState = vi.hoisted(() => ({
    connections: { REMOTE: { connection: { entered: true } } },
    remotePassword: "",
    outLocked: false,
    remoteResult: vi.fn(),
    playMedia: vi.fn(),
    playAudio: vi.fn(),
    send: vi.fn(),
    receiveRemote: {} as Record<string, (...args: any[]) => any>
}))

vi.mock("../stores", () => {
    const store = (key: "connections" | "remotePassword" | "outLocked") => ({
        subscribe(run: (value: any) => void) {
            run(testState[key])
            return () => undefined
        }
    })
    return { connections: store("connections"), remotePassword: store("remotePassword"), outLocked: store("outLocked"), shows: store("connections") }
})
vi.mock("../components/actions/api", () => ({ API_ACTIONS: { play_media: testState.playMedia, play_audio: testState.playAudio } }))
vi.mock("../components/helpers/output", () => ({ checkWindowCapture: vi.fn() }))
vi.mock("../IPC/main", () => ({ requestMainResult: testState.remoteResult }))
vi.mock("./common", () => ({ isMainWindow: () => true }))
vi.mock("./controllerTalk", () => ({ receiveCONTROLLER: {} }))
vi.mock("./remoteTalk", () => ({ receiveREMOTE: testState.receiveRemote, closeRemoteMediaConnection: vi.fn() }))
vi.mock("./stageTalk", () => ({ receiveSTAGE: {} }))

import { REMOTE } from "../../types/Channels"
import { Main } from "../../types/IPC/Main"
import { sendData } from "./sendData"

describe("remote media authorization after async validation", () => {
    beforeEach(() => {
        testState.connections = { REMOTE: { connection: { entered: true } } }
        testState.remotePassword = ""
        testState.outLocked = false
        testState.remoteResult.mockReset()
        testState.playMedia.mockReset()
        testState.playAudio.mockReset()
        testState.send.mockReset()
        Object.keys(testState.receiveRemote).forEach((key) => delete testState.receiveRemote[key])
        ;(globalThis as any).window = { api: { send: testState.send } }
    })

    it("suppresses a play effect when the remote is revoked during path validation", async () => {
        let finishValidation!: (result: any) => void
        testState.remoteResult.mockReturnValue(new Promise((resolve) => (finishValidation = resolve)))
        const pending = sendData(REMOTE, { id: "connection", channel: "API:play_media", data: { path: "/approved/media.png" } } as any)

        testState.connections.REMOTE.connection.entered = false
        finishValidation({ status: "success", data: { path: "/approved/media.png", kind: "image", size: 1, modifiedAt: 1 } })
        await pending

        expect(testState.remoteResult).toHaveBeenCalledWith(Main.REMOTE_MEDIA_RESOLVE, {
            connectionId: "connection",
            path: "/approved/media.png"
        })
        expect(testState.playMedia).not.toHaveBeenCalled()
        expect(testState.send).not.toHaveBeenCalled()
    })

    it("suppresses a media reply when the remote is revoked while its handler is pending", async () => {
        let finishHandler!: (message: any) => void
        testState.receiveRemote.MEDIA_LIST = () => new Promise((resolve) => (finishHandler = resolve))
        const pending = sendData(REMOTE, { id: "connection", channel: "MEDIA_LIST", data: { requestId: "scan", path: "", page: 0 } } as any)

        testState.connections.REMOTE.connection.entered = false
        finishHandler({ id: "connection", channel: "MEDIA_PAGE", data: { requestId: "scan" } })
        await pending

        expect(testState.send).not.toHaveBeenCalled()
    })

    it("routes validated audio paths through the audio action", async () => {
        testState.remoteResult.mockResolvedValue({ status: "success", data: { path: "/approved/song.mp3", kind: "audio", size: 1, modifiedAt: 1 } })

        await sendData(REMOTE, { id: "connection", channel: "API:play_audio", data: { path: "/approved/song.mp3" } } as any)

        expect(testState.remoteResult).toHaveBeenCalledWith(Main.REMOTE_MEDIA_RESOLVE, {
            connectionId: "connection",
            path: "/approved/song.mp3",
            kind: "audio"
        })
        expect(testState.playAudio).toHaveBeenCalledWith({ path: "/approved/song.mp3" })
        expect(testState.playMedia).not.toHaveBeenCalled()
    })
})
