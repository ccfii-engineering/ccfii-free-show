import { ipcMain, type IpcMainEvent } from "electron"
import { uid } from "uid"
import { isProd, mainWindow } from ".."
import { MAIN, Main, type MainReceiveValue, type ToMainSendValue2 } from "./../../types/IPC/Main"
import type { ToMainReceiveValue, ToMainReturnPayloads } from "./../../types/IPC/ToMain"
import { ToMain, type ToMainSendValue } from "./../../types/IPC/ToMain"
import { createIPCRequestMetadata, decodeIPCRequestReply, isIPCRequestMetadata, runIPCRequest, serializeIPCError, type IPCRequestOptions, type IPCRequestResult } from "../../types/IPC/Request"
import { mainResponses } from "./responsesMain"

export function sendToMain<ID extends ToMain>(id: ID, value?: ToMainSendValue<ID>, listenerId?: string, ipcRequest?: ToMainReceiveValue["ipcRequest"]) {
    if (!Object.values(ToMain).includes(id)) throw new Error(`Invalid channel: ${id}`)
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed?.()) return

    mainWindow.webContents.send(MAIN, { channel: id, data: value, ...(ipcRequest ? { ipcRequest } : {}) }, listenerId)
}

export function sendMain<ID extends Main>(id: ID, value: ToMainSendValue2<ID>, listenerId?: string) {
    if (!Object.values(Main).includes(id)) throw new Error(`Invalid channel: ${id}`)
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed?.()) return

    mainWindow.webContents.send(MAIN, { channel: id, data: value }, listenerId)
}

const pendingMainRequests = new Map<Electron.WebContents, Map<string, AbortController>>()
const getMainRequestKey = (channel: string, listenerId: string) => JSON.stringify([channel, listenerId])
export async function receiveMain(e: Electron.IpcMainEvent, msg: MainReceiveValue, listenerId: string) {
    if (!msg || typeof msg !== "object") return
    const hasMetadata = Object.prototype.hasOwnProperty.call(msg, "ipcRequest")
    const metadata = isIPCRequestMetadata(msg.ipcRequest) ? msg.ipcRequest : undefined
    if (hasMetadata && !metadata) return

    const id = msg.channel
    const isMainChannel = Object.values(Main).includes(id)
    if (!isMainChannel) {
        if (Object.values(ToMain).includes(id as any) || metadata) return
        throw new Error(`Invalid channel: ${id}`)
    }

    // Tagged replies are consumed only by requestToMain's correlated dispatcher.
    if (metadata?.kind === "reply") return
    if (metadata?.kind === "cancel") {
        if (listenerId && e.sender) {
            const key = getMainRequestKey(id, listenerId)
            const senderRequests = pendingMainRequests.get(e.sender)
            const controller = senderRequests?.get(key)
            controller?.abort()
            if (controller) {
                senderRequests?.delete(key)
                if (senderRequests?.size === 0 && senderRequests && pendingMainRequests.get(e.sender) === senderRequests) pendingMainRequests.delete(e.sender)
            }
        }
        return
    }

    if (metadata?.kind === "request" && !listenerId) return
    if (!mainResponses[id]) {
        if (metadata?.kind === "request" && listenerId) {
            e.reply(
                MAIN,
                {
                    channel: msg.channel,
                    data: undefined,
                    ipcRequest: createIPCRequestMetadata("reply", {
                        status: "error",
                        error: { name: "IPCHandlerError", message: `No response handler for channel: ${id}` }
                    })
                },
                listenerId
            )
        } else {
            console.error(`No response for channel: ${id}`)
        }
        return
    }

    const handler = mainResponses[id]
    const data = msg.data
    const negotiated = metadata?.kind === "request"
    const controller = negotiated && listenerId ? new AbortController() : undefined
    const key = listenerId ? getMainRequestKey(id, listenerId) : undefined
    let senderRequests: Map<string, AbortController> | undefined
    if (controller && key) {
        senderRequests = pendingMainRequests.get(e.sender)
        if (!senderRequests) {
            senderRequests = new Map()
            pendingMainRequests.set(e.sender, senderRequests)
        }
        senderRequests.set(key, controller)
    }

    try {
        const response = await (handler as any)(data, e, controller?.signal)
        // Undefined continues to mean that the handler did not reply. Null remains a value.
        if (response === undefined || (negotiated && !listenerId) || controller?.signal.aborted) return

        e.reply(
            MAIN,
            {
                channel: msg.channel,
                data: response,
                ...(negotiated ? { ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) } : {})
            },
            listenerId
        )
    } catch (error) {
        if (controller?.signal.aborted) return
        if (negotiated && listenerId) {
            e.reply(
                MAIN,
                {
                    channel: msg.channel,
                    data: undefined,
                    ipcRequest: createIPCRequestMetadata("reply", { status: "error", error: serializeIPCError(error) })
                },
                listenerId
            )
        } else {
            console.error(error)
        }
    } finally {
        if (key && controller && senderRequests?.get(key) === controller) {
            senderRequests.delete(key)
            if (senderRequests.size === 0 && pendingMainRequests.get(e.sender) === senderRequests) pendingMainRequests.delete(e.sender)
        }
    }
}

// single shared MAIN listener that routes each reply to its awaiting request by listenerId
type PendingToMain = { negotiated: boolean; receive: (msg: ToMainReceiveValue) => void }
const pendingToMain = new Map<string, PendingToMain>()
const getToMainRequestKey = (senderId: number, channel: ToMain, listenerId: string) => JSON.stringify([senderId, channel, listenerId])
let toMainDispatcherRegistered = false
function ensureToMainDispatcher() {
    if (toMainDispatcherRegistered) return
    toMainDispatcherRegistered = true
    ipcMain.on(MAIN, (e: IpcMainEvent, msg: ToMainReceiveValue, listenId: string) => {
        if (!msg || typeof msg !== "object" || !listenId) return
        const key = getToMainRequestKey(e.sender.id, msg.channel, listenId)
        const pending = pendingToMain.get(key)
        if (!pending) return

        const hasMetadata = Object.prototype.hasOwnProperty.call(msg, "ipcRequest")
        const metadata = isIPCRequestMetadata(msg.ipcRequest) ? msg.ipcRequest : undefined
        if (hasMetadata && (!metadata || metadata.kind !== "reply")) return
        if (pending.negotiated !== !!metadata) return
        pending.receive(msg)
    })
}

// @ts-ignore
// Compatibility API: non-success outcomes map to null. Use requestToMainResult when timeout,
// cancellation, and handler failure must remain distinct; this untagged path cannot propagate abort.
export async function requestToMain<ID extends ToMain, R = Awaited<ToMainReturnPayloads[ID]>>(id: ID, value: ToMainSendValue<ID>, callback?: (data: R | null) => void, timeoutMs = 15000) {
    const listenerId = id + uid(5)
    ensureToMainDispatcher()

    const result = await runIPCRequest<R>({
        timeoutMs,
        subscribe: (receive) => {
            const senderId = mainWindow?.webContents?.id ?? 0
            const key = getToMainRequestKey(senderId, id, listenerId)
            pendingToMain.set(key, {
                negotiated: false,
                receive: (msg) => receive({ status: "success", data: msg.data as R })
            })
            return () => pendingToMain.delete(key)
        },
        send: () => sendToMain(id, value, listenerId),
        cancel: () => {}
    })
    const returnData = result.status === "success" ? result.data : null

    if (result.status === "timeout" && !isProd) console.error(`IPC Message Timed Out: ${id}`)

    if (callback) callback(returnData)
    return returnData
}

// Opt-in lifecycle API for Electron requests handled by the renderer.
// @ts-ignore
export function requestToMainResult<ID extends ToMain, R = Awaited<ToMainReturnPayloads[ID]>>(id: ID, value: ToMainSendValue<ID>, options: IPCRequestOptions = {}): Promise<IPCRequestResult<R>> {
    const listenerId = id + uid(5)
    ensureToMainDispatcher()

    return runIPCRequest<R>({
        timeoutMs: options.timeoutMs ?? 15000,
        signal: options.signal,
        subscribe: (receive) => {
            const senderId = mainWindow?.webContents?.id ?? 0
            const key = getToMainRequestKey(senderId, id, listenerId)
            pendingToMain.set(key, {
                negotiated: true,
                receive: (msg) => {
                    const reply = decodeIPCRequestReply<R>(msg)
                    if (reply) receive(reply)
                }
            })
            return () => pendingToMain.delete(key)
        },
        send: () => sendToMain(id, value, listenerId, createIPCRequestMetadata("request")),
        cancel: () => sendToMain(id, undefined, listenerId, createIPCRequestMetadata("cancel"))
    })
}
