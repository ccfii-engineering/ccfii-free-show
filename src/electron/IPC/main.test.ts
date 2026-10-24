import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
    dispatch: undefined as ((event: unknown, message: any, listenerId?: string) => void) | undefined,
    handler: vi.fn(),
    send: vi.fn()
}))

vi.mock("electron", () => ({
    ipcMain: {
        on: (_channel: string, callback: (event: unknown, message: any, listenerId?: string) => void) => {
            h.dispatch = callback
        }
    }
}))
vi.mock("..", () => ({
    isProd: true,
    mainWindow: {
        isDestroyed: () => false,
        webContents: { id: 17, isDestroyed: () => false, send: (...args: any[]) => h.send(...args) }
    }
}))
vi.mock("uid", () => ({ uid: () => "request-test" }))
vi.mock("./responsesMain", () => ({ mainResponses: new Proxy({}, { get: () => h.handler }) }))

import { MAIN, Main } from "../../types/IPC/Main"
import { ToMain } from "../../types/IPC/ToMain"
import { createIPCRequestMetadata } from "../../types/IPC/Request"
import { receiveMain, requestToMainResult } from "./main"

const senders = new Map<number, { id: number }>()
const sender = (id = 17) => {
    if (!senders.has(id)) senders.set(id, { id })
    return senders.get(id)!
}
const mainEvent = (senderId = 17, reply = vi.fn()) => ({ sender: sender(senderId), reply })

describe("Electron IPC request lifecycle", () => {
    beforeEach(() => {
        h.handler.mockReset()
        h.send.mockReset()
    })

    it("registers the correlated reply dispatcher before sending and preserves falsey values", async () => {
        const sent: any[] = []
        h.send.mockImplementation((channel: string, message: any, listenerId: string) => {
            sent.push({ channel, message, listenerId })
            expect(h.dispatch).toBeTypeOf("function")
            h.dispatch?.(mainEvent(), { channel: message.channel, data: 0, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }, listenerId)
        })

        const result = await requestToMainResult(ToMain.GET_DYNAMIC_VALUES, [], { timeoutMs: 100 })

        expect(result).toEqual({ status: "success", data: 0 })
        expect(sent[0].channel).toBe(MAIN)
        expect(sent[0].message.ipcRequest).toEqual(createIPCRequestMetadata("request"))
    })

    it("times out as execution-unknown, emits correlated cancellation, and ignores a late reply", async () => {
        const sent: any[] = []
        h.send.mockImplementation((channel: string, message: any, listenerId: string) => sent.push({ channel, message, listenerId }))

        const result = await requestToMainResult(ToMain.GET_DYNAMIC_VALUES, [], { timeoutMs: 5 })
        expect(result).toEqual({ status: "timeout", execution: "unknown" })
        expect(sent.map(({ message }) => message.ipcRequest?.kind)).toEqual(["request", "cancel"])
        expect(sent[1].message.data).toBeUndefined()

        h.dispatch?.(mainEvent(), { channel: ToMain.GET_DYNAMIC_VALUES, data: { dynamic: "late" }, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }, sent[0].listenerId)
        expect(result).toEqual({ status: "timeout", execution: "unknown" })
    })

    it("passes cancellation to the active main handler and suppresses its late reply", async () => {
        let signal: AbortSignal | undefined
        let resolveHandler: ((value: unknown) => void) | undefined
        h.handler.mockImplementation((_data: unknown, _event: unknown, requestSignal: AbortSignal) => {
            signal = requestSignal
            return new Promise((resolve) => (resolveHandler = resolve))
        })
        const reply = vi.fn()
        const request = receiveMain({ ...mainEvent(), reply } as any, { channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("request") }, "active-request")

        await Promise.resolve()
        expect(signal?.aborted).toBe(false)
        await receiveMain(mainEvent() as any, { channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("cancel") }, "active-request")
        expect(signal?.aborted).toBe(true)
        resolveHandler?.(false)
        await request
        expect(reply).not.toHaveBeenCalled()
    })

    it("returns main handler failures through the negotiated result envelope", async () => {
        h.handler.mockRejectedValue(new Error("main handler failed"))
        const reply = vi.fn()

        await receiveMain({ ...mainEvent(), reply } as any, { channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("request") }, "failed-request")

        expect(reply).toHaveBeenCalledWith(
            MAIN,
            {
                channel: Main.IS_DEV,
                data: undefined,
                ipcRequest: createIPCRequestMetadata("reply", { status: "error", error: { name: "Error", message: "main handler failed" } })
            },
            "failed-request"
        )
    })

    it("keeps protocol replies and malformed envelopes out of Electron command dispatch", async () => {
        const event = mainEvent() as any

        await receiveMain(event, { channel: Main.STAGE, data: undefined, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }, "reply-message")
        await receiveMain(event, { channel: Main.STAGE, data: undefined, ipcRequest: { protocol: "freeshow-ipc-request" } } as any, "malformed-message")

        expect(h.handler).not.toHaveBeenCalled()
    })

    it("cancels only when sender, channel, and request id match", async () => {
        let signal: AbortSignal | undefined
        let resolveHandler: ((value: unknown) => void) | undefined
        h.handler.mockImplementation((_data: unknown, _event: unknown, requestSignal: AbortSignal) => {
            signal = requestSignal
            return new Promise((resolve) => (resolveHandler = resolve))
        })

        const request = receiveMain(mainEvent(17) as any, { channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("request") }, "matching-id")
        await Promise.resolve()
        expect(signal?.aborted).toBe(false)

        await receiveMain(mainEvent(18) as any, { channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("cancel") }, "matching-id")
        await receiveMain(mainEvent(17) as any, { channel: Main.STAGE, data: undefined, ipcRequest: createIPCRequestMetadata("cancel") }, "matching-id")
        await receiveMain(mainEvent(17) as any, { channel: "INVALID_CHANNEL", data: undefined, ipcRequest: createIPCRequestMetadata("cancel") } as any, "matching-id")
        expect(signal?.aborted).toBe(false)

        await receiveMain(mainEvent(17) as any, { channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("cancel") }, "matching-id")
        expect(signal?.aborted).toBe(true)
        resolveHandler?.(true)
        await request
    })

    it("correlates renderer replies by sender, channel, and listener id", async () => {
        const sent: any[] = []
        h.send.mockImplementation((channel: string, message: any, listenerId: string) => sent.push({ channel, message, listenerId }))

        const pending = requestToMainResult(ToMain.GET_DYNAMIC_VALUES, [], { timeoutMs: 100 })
        const request = sent[0]
        const validReply = { channel: ToMain.GET_DYNAMIC_VALUES, data: { dynamic: "ok" }, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }

        h.dispatch?.(mainEvent(18), validReply, request.listenerId)
        h.dispatch?.(mainEvent(17), { ...validReply, channel: ToMain.AUDIO_METADATA }, request.listenerId)
        h.dispatch?.(mainEvent(17), { ...validReply, ipcRequest: undefined }, request.listenerId)
        h.dispatch?.(mainEvent(17), validReply, "other-request")
        const sharedEvent = mainEvent(17)
        h.dispatch?.(sharedEvent, validReply, request.listenerId)
        await receiveMain(sharedEvent as any, validReply as any, request.listenerId)

        await expect(pending).resolves.toEqual({ status: "success", data: { dynamic: "ok" } })
        expect(h.handler).not.toHaveBeenCalled()
    })
})
