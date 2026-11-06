import { io } from "socket.io-client"
import type { RemoteApiChannel, RemoteProtocol, RemoteRequestKey, RemoteResponseKey, RemoteResponses } from "../../../types/remote/protocol"
import { REMOTE_PRE_AUTH_KEYS } from "../../../types/remote/protocol"
import type { WebSendArgs } from "../../../types/WebProtocol"
import { receiver } from "./receiver"
import { _get, _set, _update } from "./stores"

const socket = io()
let id: string = ""
const responseListeners = new Map<string, Set<(data: never) => void>>()

export function initSocket() {
    socket.on("connect", () => {
        id = socket.id || ""
        console.log("Connected with id:", id)

        // try accessing with saved password
        const SAVED_PASSWORD = localStorage.password
        if (SAVED_PASSWORD) {
            _update("password", "remember", true)
            _update("password", "stored", SAVED_PASSWORD)
            send("ACCESS", SAVED_PASSWORD)
            return
        }

        // check if there is a password!
        send("PASSWORD")
    })

    // the wire message is untyped; the channel decides which RemoteResponses payload it carries
    socket.on("REMOTE", (msg: { channel: string; data: unknown }) => {
        const key = msg.channel
        if (!_get("isConnected")) {
            if (!REMOTE_PRE_AUTH_KEYS.includes(key)) return
        }

        const listeners = responseListeners.get(key)
        if (listeners) {
            listeners.forEach((listener) => listener(msg.data as never))
            return
        }

        const handler = (receiver as Record<string, ((data: never) => void) | undefined>)[key]
        if (!handler) {
            if (msg.data !== null) console.log("Unhandled message:", msg)
            return
        }

        handler(msg.data as never)
    })

    socket.on("disconnect", () => _set("isConnected", false))
}

/** Listen for one response channel; the payload type comes from the protocol. */
export function onResponse<C extends RemoteResponseKey>(channel: C, listener: (data: RemoteResponses[C]) => void) {
    let listeners = responseListeners.get(channel)
    if (!listeners) {
        listeners = new Set()
        responseListeners.set(channel, listeners)
    }
    listeners.add(listener as (data: never) => void)

    return () => {
        listeners?.delete(listener as (data: never) => void)
        if (!listeners?.size) responseListeners.delete(channel)
    }
}

/** Send a protocol request, or an `API:<action>` request (its action payload is outside the protocol). */
export function send<K extends RemoteRequestKey>(channel: K, ...data: WebSendArgs<RemoteProtocol, K>): void
export function send(channel: RemoteApiChannel, data?: unknown): void
export function send(channel: string, data: unknown = null) {
    // never buffer a live action while offline: Socket.IO would replay it after reconnect
    if (!socket.connected && !REMOTE_PRE_AUTH_KEYS.includes(channel)) return
    socket.emit("REMOTE", { id, channel, data: data ?? null })
}
