import { uid } from "uid"
import type { ToMainReceiveValue, ToMainSendPayloads } from "../../types/IPC/ToMain"
import { ToMain } from "../../types/IPC/ToMain"
import type { MainReceiveValue, MainReturnPayloads } from "./../../types/IPC/Main"
import { MAIN, Main, type MainSendValue } from "./../../types/IPC/Main"
import { createIPCRequestMetadata, decodeIPCRequestReply, isIPCRequestMetadata, runIPCRequest, serializeIPCError, type IPCRequestOptions, type IPCRequestResult } from "../../types/IPC/Request"
import { mainResponses } from "./responsesMain"
import { isDev } from "../stores"
import { get } from "svelte/store"

// @ts-ignore // T extends keyof typeof Main
export function requestMainMultiple<T extends Main>(object: { [K in T]: (data: MainReturnPayloads[K] | undefined) => void }) {
    Object.keys(object).forEach((id) => {
        requestMain(id as T, undefined, object[id])
    })
}

// @ts-ignore
// Compatibility API: non-success outcomes map to undefined. Use requestMainResult when timeout,
// cancellation, and handler failure must remain distinct; this untagged path cannot propagate abort.
export async function requestMain<ID extends Main, R = Awaited<MainReturnPayloads[ID]>>(id: ID, value?: MainSendValue<ID>, callback?: (data: R | undefined) => void, waitingTimeout: number = 15000) {
    const listenerId = id + uid(5)
    const result = await runIPCRequest<R>({
        timeoutMs: waitingTimeout,
        subscribe: (receive) => {
            window.api.receive(
                MAIN,
                (msg: MainReceiveValue, listenId: string) => {
                    if (msg && msg.channel === id && listenId === listenerId && !Object.prototype.hasOwnProperty.call(msg, "ipcRequest")) receive({ status: "success", data: msg.data as R })
                },
                listenerId
            )
            return () => window.api.removeListener(MAIN, listenerId)
        },
        send: () => sendMain(id, value, listenerId),
        cancel: () => {}
    })
    const returnData = result.status === "success" ? result.data : undefined

    if (result.status === "timeout" && get(isDev)) console.error(`IPC Message Timed Out: ${id}`)

    if (callback) callback(returnData)
    return returnData
}

// Opt-in lifecycle API. A timeout has unknown execution status and is never retried here.
// @ts-ignore
export function requestMainResult<ID extends Main, R = Awaited<MainReturnPayloads[ID]>>(id: ID, value?: MainSendValue<ID>, options: IPCRequestOptions = {}): Promise<IPCRequestResult<R>> {
    const listenerId = id + uid(5)

    return runIPCRequest<R>({
        timeoutMs: options.timeoutMs ?? 15000,
        signal: options.signal,
        subscribe: (receive) => {
            window.api.receive(
                MAIN,
                (msg: MainReceiveValue, listenId: string) => {
                    if (msg.channel !== id || listenId !== listenerId) return
                    const reply = decodeIPCRequestReply<R>(msg)
                    if (reply) receive(reply)
                },
                listenerId
            )

            return () => window.api.removeListener(MAIN, listenerId)
        },
        send: () => sendMain(id, value, listenerId, createIPCRequestMetadata("request")),
        cancel: () => sendMain(id, undefined, listenerId, createIPCRequestMetadata("cancel"))
    })
}

export function sendMainMultiple<T extends Main>(keys: T[]) {
    keys.forEach((id) => sendMain(id))
}

export function sendMain<ID extends Main>(id: ID, value?: MainSendValue<ID>, listenerId?: string, ipcRequest?: MainReceiveValue["ipcRequest"]) {
    if (!Object.values(Main).includes(id)) throw new Error(`Invalid channel: ${id}`)
    if (!window.api) return

    window.api.send(MAIN, { channel: id, data: value, ...(ipcRequest ? { ipcRequest } : {}) }, listenerId)
}

let mainGlobalReceiverRegistered = false
const pendingFrontendRequests = new Map<string, AbortController>()
const requestKey = (channel: string, listenerId: string) => JSON.stringify([channel, listenerId])
export function receiveMainGlobal() {
    if (mainGlobalReceiverRegistered) return
    mainGlobalReceiverRegistered = true

    window.api.receive(MAIN, async (msg: MainReceiveValue | ToMainReceiveValue, listenerId?: string) => {
        if (!msg || typeof msg !== "object") return
        const id = msg.channel
        const hasMetadata = Object.prototype.hasOwnProperty.call(msg, "ipcRequest")
        const metadata = isIPCRequestMetadata(msg.ipcRequest) ? msg.ipcRequest : undefined
        // A protocol envelope is never an application message. Replies belong to the
        // correlated request listener; malformed or unsupported envelopes are ignored.
        if (hasMetadata && !metadata) return
        if (metadata?.kind === "reply") return

        const validChannel = Object.values({ ...Main, ...ToMain }).includes(id)
        if (!validChannel) {
            if (metadata) return
            throw new Error(`Invalid channel: ${id}`)
        }
        if (metadata?.kind === "cancel") {
            if (listenerId) {
                const key = requestKey(id, listenerId)
                const controller = pendingFrontendRequests.get(key)
                controller?.abort()
                if (controller) pendingFrontendRequests.delete(key)
            }
            return
        }

        const negotiated = metadata?.kind === "request"
        if (negotiated && !listenerId) return
        if (!mainResponses[id]) {
            if (negotiated && listenerId) {
                window.api.send(
                    MAIN,
                    {
                        channel: id,
                        data: undefined,
                        ipcRequest: createIPCRequestMetadata("reply", {
                            status: "error",
                            error: { name: "IPCHandlerError", message: `No response handler for channel: ${id}` }
                        })
                    },
                    listenerId
                )
            }
            return // console.error(`No response for channel: ${id}`)
        }

        const controller = negotiated && listenerId ? new AbortController() : undefined
        const key = listenerId ? requestKey(id, listenerId) : undefined
        if (controller && key) pendingFrontendRequests.set(key, controller)

        try {
            const response = await (mainResponses[id] as any)(msg.data, controller?.signal)
            if (response === undefined || controller?.signal.aborted || (negotiated && !listenerId)) return

            window.api.send(
                MAIN,
                {
                    channel: id,
                    data: response,
                    ...(negotiated ? { ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) } : {})
                },
                listenerId
            )
        } catch (error) {
            if (controller?.signal.aborted) return
            if (negotiated && listenerId) {
                window.api.send(
                    MAIN,
                    {
                        channel: id,
                        data: undefined,
                        ipcRequest: createIPCRequestMetadata("reply", { status: "error", error: serializeIPCError(error) })
                    },
                    listenerId
                )
            } else {
                console.error(error)
            }
        } finally {
            if (key && controller && pendingFrontendRequests.get(key) === controller) pendingFrontendRequests.delete(key)
        }
    })
}

// @ts-ignore works as it should
export function receiveMain<ID extends Main, R = Awaited<MainReturnPayloads[ID]>>(id: ID, callback: (data: R) => void) {
    if (!Object.values(Main).includes(id)) throw new Error(`Invalid channel: ${id}`)
    const listenerId = uid()

    window.api.receive(
        MAIN,
        (msg: MainReceiveValue) => {
            if (msg && msg.channel === id && !Object.prototype.hasOwnProperty.call(msg, "ipcRequest")) callback(msg.data as R)
        },
        listenerId
    )

    return listenerId
}

export function receiveToMain<ID extends ToMain, R = Awaited<ToMainSendPayloads[ID]>>(id: ID, callback: (data: R) => void) {
    if (!Object.values(ToMain).includes(id)) throw new Error(`Invalid channel: ${id}`)
    const listenerId = uid()

    window.api.receive(
        MAIN,
        (msg: ToMainReceiveValue) => {
            if (msg && msg.channel === id && !Object.prototype.hasOwnProperty.call(msg, "ipcRequest")) callback(msg.data as R)
        },
        listenerId
    )

    return listenerId
}

export function destroyMain(listenerId: string) {
    window.api.removeListener(MAIN, listenerId)
}

// Indexer streaming: per-request batch subscribers
type BatchHandler<T> = (data: T) => void
const batchSubscribers = new Map<string, BatchHandler<any>>()

export function subscribeBatches<T extends { requestId: string }>(requestId: string, handler: BatchHandler<T>): () => void {
    batchSubscribers.set(requestId, handler)
    return () => {
        batchSubscribers.delete(requestId)
    }
}

export function dispatchBatch<T extends { requestId: string }>(payload: T) {
    const handler = batchSubscribers.get(payload.requestId)
    if (handler) handler(payload)
}
