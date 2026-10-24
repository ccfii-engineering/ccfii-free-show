import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ responses: {} as Record<string, any>, uid: 0 }))
vi.mock("../stores", () => ({ isDev: false }))
vi.mock("svelte/store", () => ({ get: (value: unknown) => value }))
vi.mock("uid", () => ({ uid: () => `request-test-${++h.uid}` }))
vi.mock("./responsesMain", () => ({ mainResponses: h.responses }))

import { MAIN, Main } from "../../types/IPC/Main"
import { createIPCRequestMetadata } from "../../types/IPC/Request"
import { receiveMainGlobal, requestMain, requestMainResult } from "./main"

const listeners = new Map<string, (message: any, listenerId: string) => void>()
let globalReceiver: ((message: any, listenerId?: string) => Promise<void>) | undefined
let onSend: ((message: any, listenerId?: string) => void) | undefined
const api = {
    send: vi.fn((_channel: string, message: any, listenerId?: string) => onSend?.(message, listenerId)),
    receive: vi.fn((_channel: string, callback: (message: any, listenerId: string) => void, listenerId?: string) => {
        if (listenerId) listeners.set(listenerId, callback)
        else globalReceiver = callback as (message: any, listenerId?: string) => Promise<void>
    }),
    removeListener: vi.fn((_channel: string, listenerId: string) => listeners.delete(listenerId)),
    getListeners: () => [],
    showFilePath: (file: File) => file.name
}
const deliverLikePreload = async (message: any, listenerId?: string) => {
    await globalReceiver?.(message, listenerId)
    if (listenerId) listeners.get(listenerId)?.(message, listenerId)
}

describe("generic MAIN request lifecycle", () => {
    beforeAll(() => {
        vi.stubGlobal("window", { api })
        receiveMainGlobal()
    })

    beforeEach(() => {
        listeners.clear()
        api.send.mockClear()
        api.receive.mockClear()
        api.removeListener.mockClear()
        onSend = undefined
        h.uid = 0
        Object.keys(h.responses).forEach((key) => delete h.responses[key])
    })

    it("registers before sending and returns falsey values through the negotiated protocol", async () => {
        for (const value of [false, 0, "", null]) {
            let requestId = ""
            onSend = (request, listenerId) => {
                requestId = listenerId || ""
                expect(request.ipcRequest).toEqual(createIPCRequestMetadata("request"))
                expect(listeners.has(requestId)).toBe(true)
                listeners.get(requestId)?.({ channel: request.channel, data: value, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }, requestId)
            }

            const result = await requestMainResult(Main.IS_DEV, undefined, { timeoutMs: 100 })
            expect(result).toEqual({ status: "success", data: value })
            expect(listeners.has(requestId)).toBe(false)
        }
    })

    it("keeps ordinary response objects unchanged even when their fields resemble protocol metadata", async () => {
        const applicationValue = {
            status: "error",
            error: { name: "ApplicationError", message: "data" },
            ipcRequest: { protocol: "freeshow-ipc-request", version: 1, kind: "reply", status: "error" }
        }
        onSend = (request, listenerId) => {
            listeners.get(listenerId || "")?.({ channel: request.channel, data: applicationValue, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }, listenerId || "")
        }

        const result = await requestMainResult(Main.IS_DEV, undefined, { timeoutMs: 100 })
        expect(result).toEqual({ status: "success", data: applicationValue })
    })

    it("reports handler failure and cleans up its correlated listener", async () => {
        onSend = (request, listenerId) => {
            listeners.get(listenerId || "")?.(
                {
                    channel: request.channel,
                    data: undefined,
                    ipcRequest: createIPCRequestMetadata("reply", { status: "error", error: { name: "Error", message: "handler failed" } })
                },
                listenerId || ""
            )
        }

        const result = await requestMainResult(Main.IS_DEV, undefined, { timeoutMs: 100 })
        expect(result).toEqual({ status: "error", error: { name: "Error", message: "handler failed" } })
        expect(listeners.size).toBe(0)
        expect(api.removeListener).toHaveBeenCalledWith(MAIN, `${Main.IS_DEV}request-test-1`)
    })

    it("routes a broadcast negotiated reply only to its correlated request listener", async () => {
        const appHandler = vi.fn()
        h.responses[Main.STAGE] = appHandler
        onSend = async (request, listenerId) => {
            await deliverLikePreload(
                {
                    channel: request.channel,
                    data: undefined,
                    ipcRequest: createIPCRequestMetadata("reply", { status: "error", error: { name: "Error", message: "request failed" } })
                },
                listenerId
            )
        }

        const result = await requestMainResult(Main.STAGE, undefined, { timeoutMs: 100 })

        expect(result).toEqual({ status: "error", error: { name: "Error", message: "request failed" } })
        expect(appHandler).not.toHaveBeenCalled()
    })

    it("does not dispatch malformed envelopes or unmatched cancellation as application messages", async () => {
        const appHandler = vi.fn()
        h.responses[Main.IS_DEV] = appHandler

        await globalReceiver?.({ channel: Main.IS_DEV, data: true, ipcRequest: { protocol: "freeshow-ipc-request" } }, "malformed-envelope")
        await globalReceiver?.({ channel: "INVALID_CHANNEL", data: undefined, ipcRequest: createIPCRequestMetadata("cancel") }, "invalid-cancel")

        expect(appHandler).not.toHaveBeenCalled()
    })

    it("keeps legacy requests untagged while returning their original undefined-on-timeout shape", async () => {
        onSend = (request, listenerId) => {
            expect(request.ipcRequest).toBeUndefined()
            listeners.get(listenerId || "")?.({ channel: request.channel, data: false }, listenerId || "")
        }

        await expect(requestMain(Main.IS_DEV, undefined)).resolves.toBe(false)
        expect(listeners.size).toBe(0)
    })

    it("sends cancellation on timeout and ignores the late correlated reply", async () => {
        let reply: ((message: any, listenerId: string) => void) | undefined
        let requestId = ""
        const sent: any[] = []
        onSend = (message, listenerId) => {
            sent.push(message)
            requestId = listenerId || ""
            if (message.ipcRequest?.kind === "request") reply = listeners.get(requestId)
        }

        const result = await requestMainResult(Main.IS_DEV, undefined, { timeoutMs: 5 })
        expect(result).toEqual({ status: "timeout", execution: "unknown" })
        expect(sent.map((message) => message.ipcRequest?.kind)).toEqual(["request", "cancel"])
        expect(sent[1].data).toBeUndefined()
        expect(listeners.size).toBe(0)

        reply?.({ channel: Main.IS_DEV, data: true, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }, requestId)
        expect(result).toEqual({ status: "timeout", execution: "unknown" })
    })

    it("propagates an AbortSignal cancellation and cleans up the local reply listener", async () => {
        const controller = new AbortController()
        const sent: any[] = []
        onSend = (message, listenerId) => sent.push({ message, listenerId })

        const pending = requestMainResult(Main.IS_DEV, undefined, { timeoutMs: 100, signal: controller.signal })
        controller.abort()

        expect(await pending).toEqual({ status: "cancelled", work: "may-continue" })
        expect(sent.map(({ message }) => message.ipcRequest?.kind)).toEqual(["request", "cancel"])
        expect(listeners.size).toBe(0)
        expect(sent[1].listenerId).toBe(sent[0].listenerId)
    })

    it("encodes falsey global-handler values and handler errors in negotiated reply metadata", async () => {
        h.responses[Main.IS_DEV] = () => false
        const request = globalReceiver?.({ channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("request") }, "global-false")
        await request
        expect(api.send).toHaveBeenCalledWith(MAIN, { channel: Main.IS_DEV, data: false, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }, "global-false")

        api.send.mockClear()
        h.responses[Main.IS_DEV] = () => {
            throw new Error("frontend handler failed")
        }
        await globalReceiver?.({ channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("request") }, "global-error")
        expect(api.send).toHaveBeenCalledWith(MAIN, { channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("reply", { status: "error", error: { name: "Error", message: "frontend handler failed" } }) }, "global-error")
    })

    it("reports an unregistered response handler as a negotiated failure", async () => {
        await globalReceiver?.({ channel: Main.VERSION, data: undefined, ipcRequest: createIPCRequestMetadata("request") }, "missing-handler")
        expect(api.send).toHaveBeenCalledWith(
            MAIN,
            {
                channel: Main.VERSION,
                data: undefined,
                ipcRequest: createIPCRequestMetadata("reply", {
                    status: "error",
                    error: { name: "IPCHandlerError", message: `No response handler for channel: ${Main.VERSION}` }
                })
            },
            "missing-handler"
        )
    })

    it("aborts negotiated handler work and suppresses its late reply", async () => {
        let resolveHandler: ((value: unknown) => void) | undefined
        let signal: AbortSignal | undefined
        h.responses[Main.IS_DEV] = (_data: unknown, requestSignal: AbortSignal) => {
            signal = requestSignal
            return new Promise((resolve) => (resolveHandler = resolve))
        }

        const pending = globalReceiver?.({ channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("request") }, "global-cancel")
        await Promise.resolve()
        expect(signal?.aborted).toBe(false)

        await globalReceiver?.({ channel: Main.STAGE, data: undefined, ipcRequest: createIPCRequestMetadata("cancel") }, "global-cancel")
        await globalReceiver?.({ channel: "INVALID_CHANNEL", data: undefined, ipcRequest: createIPCRequestMetadata("cancel") }, "global-cancel")
        expect(signal?.aborted).toBe(false)

        await globalReceiver?.({ channel: Main.IS_DEV, data: undefined, ipcRequest: createIPCRequestMetadata("cancel") }, "global-cancel")
        expect(signal?.aborted).toBe(true)
        resolveHandler?.(true)
        await pending
        expect(api.send).not.toHaveBeenCalled()
    })
})
