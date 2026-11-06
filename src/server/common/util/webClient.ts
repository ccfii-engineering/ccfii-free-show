import { io } from "socket.io-client"
import { uid } from "uid"
import type { WebProtocolDef, WebReceiverTable, WebSendArgs } from "../../../types/WebProtocol"

// The one socket client for every web app (Remote, Stage, Controller, Cam, Output stream).
// It owns: connect, reconnect, the password/ready handshake, request/response, and the offline-send rule.
//
// Offline-send rule (PRODUCT.md): a live action is never buffered while disconnected. Socket.IO would
// replay it after reconnect, so send() drops it unless its key is a pre-auth key. Data requests that the
// view needs again after a reconnect (show, project, layout reloads) are a different thing: they are
// re-issued, once, when the app marks the connection ready again (e.g. after the password was accepted).

/** the part of a Socket.IO client socket this module uses; tests pass a fake */
export interface WebSocketLike {
    id?: string
    connected: boolean
    on(event: string, listener: (...args: any[]) => void): unknown
    emit(event: string, ...args: any[]): unknown
    io?: { on(event: string, listener: (...args: any[]) => void): unknown }
}

export interface WebClientOptions<R extends object> {
    /** Socket.IO event name carrying every message of this app: "REMOTE", "STAGE", ... */
    event: string
    /** socket factory; defaults to `io()` */
    connect?: () => WebSocketLike
    /** keys that may be sent while disconnected, and that are accepted before the connection is ready */
    preAuthKeys?: readonly string[]
    /** drop responses other than pre-auth keys until the connection is ready */
    gateInbound?: boolean
    /** the connection is ready as soon as it connects (no password or layout handshake) */
    autoReady?: boolean
    /** data requests to re-issue after a reconnect: the latest payload per key */
    replay?: (channel: string, data: unknown) => boolean
    onConnect?: (info: { reconnect: boolean; id: string }) => void
    onDisconnect?: (reason: string) => void
    onConnectError?: (error: unknown) => void
    onReconnectAttempt?: () => void
    onUnhandled?: (msg: WebWireMessage) => void
    /** request() gives up after this many ms and resolves null */
    requestTimeoutMs?: number
    /** phantom type so the receiver table is checked against the response map */
    responses?: R
}

/** the wire message is the one untyped seam; the channel decides which payload it carries */
export interface WebWireMessage {
    channel: string
    data?: unknown
    id?: string
    listenerId?: string
}

interface Remembered {
    data: unknown
    pending: boolean
}

export function createWebClient<P extends WebProtocolDef<P>, R extends object>(options: WebClientOptions<R>) {
    const socket = options.connect ? options.connect() : (io() as unknown as WebSocketLike)
    const preAuthKeys = options.preAuthKeys || []
    const timeoutDefault = options.requestTimeoutMs ?? 3000

    let id = ""
    let ready = false
    let hasConnected = false
    let receiver: WebReceiverTable<R> = {}
    let started = false

    const responseListeners = new Map<string, Set<(data: never) => void>>()
    const remembered = new Map<string, Remembered>()
    const pendingRequests = new Map<string, { resolve: (value: unknown) => void; timeout: ReturnType<typeof setTimeout> }>()

    function emit(channel: string, data: unknown, extra: Record<string, unknown> = {}) {
        socket.emit(options.event, { id, channel, data: data ?? null, ...extra })
    }

    function sendRaw(channel: string, data: unknown = null) {
        const payload = data ?? null
        if (options.replay?.(channel, payload)) remembered.set(channel, { data: payload, pending: !(socket.connected && ready) })

        // never buffer a live action while offline: Socket.IO would replay it after reconnect
        if (!socket.connected && !preAuthKeys.includes(channel)) return
        emit(channel, payload)
    }

    function flushReplay() {
        remembered.forEach((entry, channel) => {
            if (!entry.pending) return
            entry.pending = false
            emit(channel, entry.data)
        })
    }

    function setReady(value: boolean) {
        ready = value
        if (value && socket.connected) flushReplay()
    }

    function resolveAllRequests() {
        pendingRequests.forEach((pending) => {
            clearTimeout(pending.timeout)
            pending.resolve(null)
        })
        pendingRequests.clear()
    }

    function receive(msg: WebWireMessage) {
        const channel = msg.channel
        if (options.gateInbound && !ready && !preAuthKeys.includes(channel)) return

        if (msg.listenerId) {
            const pending = pendingRequests.get(msg.listenerId)
            if (pending) {
                clearTimeout(pending.timeout)
                pendingRequests.delete(msg.listenerId)
                pending.resolve(msg.data)
                return
            }
        }

        const listeners = responseListeners.get(channel)
        if (listeners) {
            listeners.forEach((listener) => listener(msg.data as never))
            return
        }

        const handler = (receiver as Record<string, ((data: never) => void) | undefined>)[channel]
        if (!handler) {
            if (options.onUnhandled) options.onUnhandled(msg)
            else if (msg.data !== null && msg.data !== undefined) console.log("Unhandled message:", msg)
            return
        }

        handler(msg.data as never)
    }

    /** Attach the receiver table and start listening. Call once; the socket itself connects on creation. */
    function start(table: WebReceiverTable<R> = {}) {
        receiver = table
        if (started) return
        started = true

        socket.on("connect", () => {
            id = socket.id || ""
            console.log("Connected with id:", id)
            const reconnect = hasConnected
            hasConnected = true
            ready = false
            // anything asked for before this connection was usable is re-issued once it is ready
            remembered.forEach((entry) => (entry.pending = true))
            options.onConnect?.({ reconnect, id })
            if (options.autoReady) setReady(true)
        })
        socket.on("disconnect", (reason: string) => {
            ready = false
            remembered.forEach((entry) => (entry.pending = true))
            resolveAllRequests()
            options.onDisconnect?.(reason)
        })
        socket.on("connect_error", (error: unknown) => options.onConnectError?.(error))
        socket.io?.on("reconnect_attempt", () => options.onReconnectAttempt?.())
        socket.on(options.event, (msg: WebWireMessage) => receive(msg))
    }

    /** Listen for one response channel; the payload type comes from the protocol. Replaces the receiver for it. */
    function onResponse<C extends keyof R & string>(channel: C, listener: (data: R[C]) => void) {
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

    /** Ask and wait for the reply that carries the same listenerId. Resolves null when offline, on timeout or on disconnect. */
    function request<T = unknown>(channel: string, data: unknown = null, timeoutMs = timeoutDefault): Promise<T | null> {
        if (!socket.connected) return Promise.resolve(null)

        const listenerId = channel + uid(5)
        return new Promise<T | null>((resolve) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(listenerId)
                resolve(null)
            }, timeoutMs)
            pendingRequests.set(listenerId, { resolve: resolve as (value: unknown) => void, timeout })
            emit(channel, data, { listenerId })
        })
    }

    return {
        start,
        /** Send a protocol request; the payload is omitted when the request carries none. */
        send<K extends keyof P & string>(channel: K, ...data: WebSendArgs<P, K>) {
            sendRaw(channel, data[0] ?? null)
        },
        /** Send a request outside the protocol, e.g. `API:<action>` (the action registry is separate). */
        sendRaw,
        request,
        onResponse,
        setReady,
        get connected() {
            return socket.connected
        },
        get ready() {
            return ready
        },
        get id() {
            return id
        }
    }
}

export type WebClient<P extends WebProtocolDef<P>, R extends object> = ReturnType<typeof createWebClient<P, R>>
