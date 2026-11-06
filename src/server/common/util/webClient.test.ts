import { describe, expect, it, vi } from "vitest"
import type { WebProtocolDef } from "../../../types/WebProtocol"
import { createWebClient, type WebSocketLike } from "./webClient"

// One test suite for the shared web socket client: connect, reconnect replay, request/response
// and the offline-send rule. Only the socket is faked.

type Handler = (...args: any[]) => void
function fakeSocket() {
    const handlers: Record<string, Handler[]> = {}
    const emitted: { event: string; msg: any }[] = []
    const socket = {
        id: "",
        connected: false,
        on: (event: string, fn: Handler) => {
            ;(handlers[event] ||= []).push(fn)
            return socket
        },
        io: { on: () => undefined },
        emit: (event: string, msg: any) => {
            emitted.push({ event, msg })
            return socket
        },
        fire: (event: string, ...args: any[]) => (handlers[event] || []).forEach((fn) => fn(...args)),
        emitted,
        connect(id = "s1") {
            socket.id = id
            socket.connected = true
            socket.fire("connect")
        },
        drop(reason = "transport close") {
            socket.connected = false
            socket.fire("disconnect", reason)
        }
    }
    return socket satisfies WebSocketLike
}

interface Replies {
    PASSWORD: { password: boolean }
    ACCESS: null
    ERROR: string
    SHOW: { id: string }
    OUT: { slide: number | null }
    OUT_DATA: Record<string, never>
}
interface Protocol {
    PASSWORD: { request: null; replies: Pick<Replies, "PASSWORD"> }
    ACCESS: { request: string; replies: Pick<Replies, "ACCESS" | "ERROR"> }
    SHOW: { request: string; replies: Pick<Replies, "SHOW"> }
    OUT: { request: number | null; replies: Pick<Replies, "OUT"> }
    OUT_DATA: { request: null; replies: Pick<Replies, "OUT_DATA"> }
    LIVE: { request: null; replies: Record<never, never> }
}
export type ProtocolCheck = WebProtocolDef<Protocol>

function setup(options: { autoReady?: boolean; gateInbound?: boolean } = {}) {
    const socket = fakeSocket()
    const received: { channel: string; data: unknown }[] = []
    const connects: boolean[] = []
    const client = createWebClient<Protocol, Replies>({
        event: "REMOTE",
        connect: () => socket,
        preAuthKeys: ["PASSWORD", "ACCESS", "ERROR"],
        // SHOW is replayed as the read-only GET_SHOW; OUT only as the null query
        replay: (channel, data) => (channel === "SHOW" ? { channel: "GET_SHOW", data } : channel === "OUT_DATA" || (channel === "OUT" && data === null) ? { channel, data: null } : null),
        onConnect: ({ reconnect }) => {
            connects.push(reconnect)
            client.send("PASSWORD")
        },
        ...options
    })
    client.start({
        ERROR: (data) => void received.push({ channel: "ERROR", data }),
        SHOW: (data) => void received.push({ channel: "SHOW", data })
    })
    const sent = () => socket.emitted.map((a) => ({ channel: a.msg.channel, data: a.msg.data }))
    return { socket, client, received, connects, sent }
}

describe("shared web client", () => {
    it("connects, announces itself with its socket id and reports reconnects", () => {
        const { socket, connects, sent } = setup()
        socket.connect("abc")
        expect(socket.emitted[0].event).toBe("REMOTE")
        expect(socket.emitted[0].msg).toEqual({ id: "abc", channel: "PASSWORD", data: null })
        socket.drop()
        socket.connect("def")
        expect(connects).toEqual([false, true])
        expect(sent().filter((a) => a.channel === "PASSWORD")).toHaveLength(2)
    })

    it("drops live sends while disconnected and never buffers them for replay", () => {
        const { socket, client, sent } = setup()
        socket.connect()
        socket.drop()
        socket.emitted.length = 0
        client.send("LIVE")
        client.send("OUT", 3)
        expect(sent()).toEqual([])
        // pre-auth keys are still allowed
        client.send("ACCESS", "secret")
        expect(sent()).toEqual([{ channel: "ACCESS", data: "secret" }])
        // reconnect: the dropped live actions are not replayed
        socket.connect()
        client.setReady(true)
        expect(sent().filter((a) => a.channel === "LIVE" || (a.channel === "OUT" && a.data === 3))).toEqual([])
    })

    it("re-issues the latest data requests after reconnect once the connection is ready", () => {
        const { socket, client, sent } = setup()
        socket.connect()
        client.setReady(true)
        client.send("SHOW", "a")
        client.send("SHOW", "b")
        client.send("OUT", null)
        client.send("OUT", 4) // a live action, not a data request
        socket.emitted.length = 0

        socket.drop()
        client.send("SHOW", "c") // asked for while offline: dropped now, replayed after reconnect
        expect(sent()).toEqual([])

        socket.connect()
        // not ready (not authorized) yet: only the connect-time request goes out
        expect(sent()).toEqual([{ channel: "PASSWORD", data: null }])

        client.setReady(true)
        expect(sent().slice(1)).toEqual([
            { channel: "GET_SHOW", data: "c" },
            { channel: "OUT", data: null }
        ])
        expect(sent().some((a) => a.channel === "OUT" && a.data === 4)).toBe(false)

        // a second reconnect replays the latest again; nothing is sent twice per reconnect
        socket.emitted.length = 0
        socket.drop()
        socket.connect()
        client.setReady(true)
        client.setReady(true)
        expect(sent().filter((a) => a.channel === "GET_SHOW")).toEqual([{ channel: "GET_SHOW", data: "c" }])
        // the state-changing SHOW itself is never re-sent
        expect(sent().some((a) => a.channel === "SHOW")).toBe(false)
    })

    it("only accepts pre-auth responses until ready when the inbound gate is on", () => {
        const { socket, client, received } = setup({ gateInbound: true })
        socket.connect()
        socket.fire("REMOTE", { channel: "SHOW", data: { id: "x" } })
        socket.fire("REMOTE", { channel: "ERROR", data: "wrongPass" })
        expect(received).toEqual([{ channel: "ERROR", data: "wrongPass" }])
        client.setReady(true)
        socket.fire("REMOTE", { channel: "SHOW", data: { id: "x" } })
        expect(received).toHaveLength(2)
        socket.drop()
        socket.connect()
        socket.fire("REMOTE", { channel: "SHOW", data: { id: "y" } })
        expect(received).toHaveLength(2)
    })

    it("delivers responses to onResponse listeners before the receiver table", () => {
        const { socket, client, received } = setup()
        socket.connect()
        const listener = vi.fn()
        const off = client.onResponse("SHOW", listener)
        socket.fire("REMOTE", { channel: "SHOW", data: { id: "x" } })
        expect(listener).toHaveBeenCalledWith({ id: "x" })
        expect(received).toEqual([])
        off()
        socket.fire("REMOTE", { channel: "SHOW", data: { id: "z" } })
        expect(received).toEqual([{ channel: "SHOW", data: { id: "z" } }])
    })

    it("resolves a request with the reply matched by listenerId, and with null on timeout, disconnect or offline", async () => {
        vi.useFakeTimers()
        try {
            const { socket, client } = setup()
            expect(await client.request("API:get_dynamic_value", { value: "x" })).toBeNull() // offline

            socket.connect()
            const pending = client.request("API:get_dynamic_value", { value: "x" })
            const request = socket.emitted.at(-1)!.msg
            expect(request.listenerId).toMatch(/^API:get_dynamic_value/)
            socket.fire("REMOTE", { channel: "API", listenerId: request.listenerId, data: "resolved" })
            expect(await pending).toBe("resolved")

            const timedOut = client.request("API:get_dynamic_value", null, 500)
            await vi.advanceTimersByTimeAsync(500)
            expect(await timedOut).toBeNull()

            const interrupted = client.request("API:get_dynamic_value")
            socket.drop()
            expect(await interrupted).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })
})
