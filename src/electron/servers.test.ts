import net from "net"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { io as connect, type Socket } from "socket.io-client"

const mocks = vi.hoisted(() => ({
    toApp: vi.fn(),
    publishPort: vi.fn(),
    unpublishPorts: vi.fn()
}))

vi.mock("electron", () => ({ ipcMain: { on: vi.fn() } }))
vi.mock("./index", () => ({ toApp: mocks.toApp }))
vi.mock("./data/bonjour", () => ({ publishPort: mocks.publishPort, unpublishPorts: mocks.unpublishPorts }))
vi.mock("./output/OutputHelper", () => ({ OutputHelper: { getOutput: vi.fn() } }))
vi.mock("./capture/CaptureHelper", () => ({ CaptureHelper: { captureBase64Frame: vi.fn() } }))

import { closeServers, getConnections, getStageStreamSubscriberIds, startServers, toServer, toStageStreamSubscribers } from "./servers"

const sockets: Socket[] = []
const ports: { remote: number; stage: number; output_stream: number } = { remote: 0, stage: 0, output_stream: 0 }

async function reservePort(): Promise<number> {
    const server = net.createServer()
    await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve())))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Could not reserve a local test port")
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    return address.port
}

async function openSocket(port: number): Promise<Socket> {
    const socket = connect(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false, timeout: 2000 })
    sockets.push(socket)
    await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve())
        socket.once("connect_error", reject)
    })
    return socket
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 2000) {
    const started = performance.now()
    while (!predicate()) {
        if (performance.now() - started > timeoutMs) throw new Error(message)
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

function receiveChannel(socket: Socket, channel: string): Promise<any> {
    return new Promise((resolve) => socket.once(channel, resolve))
}

describe("distribution server compatibility", () => {
    beforeAll(async () => {
        ports.remote = await reservePort()
        ports.stage = await reservePort()
        ports.output_stream = await reservePort()

        startServers({
            ports,
            max: 10,
            disabled: { remote: false, stage: false, controller: true, output_stream: false },
            data: {}
        } as any)
    })

    afterAll(() => {
        sockets.forEach((socket) => socket.disconnect())
        closeServers()
    })

    it("enforces the configured remote client cap and frees a slot after disconnect", async () => {
        const clients: Socket[] = []
        for (let i = 0; i < 10; i++) clients.push(await openSocket(ports.remote))
        await waitFor(() => getConnections("REMOTE") === 10, "Remote server did not reach its client cap")

        const rejected = await openSocket(ports.remote)
        await waitFor(() => !rejected.connected && getConnections("REMOTE") === 10, "Remote server did not reject an over-cap client")

        clients[0].disconnect()
        await waitFor(() => getConnections("REMOTE") === 9, "Remote disconnect did not free a client slot")
        const replacement = await openSocket(ports.remote)
        await waitFor(() => getConnections("REMOTE") === 10, "Remote server did not accept a replacement client")
        expect(replacement.connected).toBe(true)
    }, 10000)

    it("sends stage frames only to active subscribers and expires stale subscriptions", async () => {
        const active = await openSocket(ports.stage)
        const inactive = await openSocket(ports.stage)
        const activeFrames: any[] = []
        const inactiveFrames: any[] = []
        active.on("STAGE", (msg) => msg.channel === "STREAM_FRAME" && activeFrames.push(msg))
        inactive.on("STAGE", (msg) => msg.channel === "STREAM_FRAME" && inactiveFrames.push(msg))

        const now = vi.spyOn(Date, "now").mockReturnValue(1000)
        active.emit("STAGE", { channel: "STREAM_SUBSCRIBE", data: { outputId: "output-a" } })
        await waitFor(() => getStageStreamSubscriberIds().includes(active.id || ""), "Stage client did not subscribe")
        expect(getStageStreamSubscriberIds()).toEqual([active.id])

        toStageStreamSubscribers({ channel: "STREAM_FRAME", data: { id: "output-a", jpeg: Buffer.from("frame") } })
        await waitFor(() => activeFrames.length === 1, "Active stage subscriber did not receive a frame")
        expect(inactiveFrames).toHaveLength(0)

        active.emit("STAGE", { channel: "STREAM_UNSUBSCRIBE", data: null })
        await waitFor(() => getStageStreamSubscriberIds().length === 0, "Stage unsubscribe did not clear subscription")
        toStageStreamSubscribers({ channel: "STREAM_FRAME", data: { id: "output-a", jpeg: Buffer.from("next") } })
        await new Promise((resolve) => setTimeout(resolve, 25))
        expect(activeFrames).toHaveLength(1)

        active.emit("STAGE", { channel: "STREAM_SUBSCRIBE", data: { outputId: "output-a" } })
        await waitFor(() => getStageStreamSubscriberIds().includes(active.id || ""), "Stage client did not renew subscription")
        now.mockReturnValue(11001)
        expect(getStageStreamSubscriberIds()).toEqual([])
        toStageStreamSubscribers({ channel: "STREAM_FRAME", data: { id: "output-a", jpeg: Buffer.from("expired") } })
        await new Promise((resolve) => setTimeout(resolve, 25))
        expect(activeFrames).toHaveLength(1)
        expect(inactiveFrames).toHaveLength(0)
        now.mockRestore()
    })

    it("holds one output-stream frame until that output is acknowledged, then resets on reconnect", async () => {
        const client = await openSocket(ports.output_stream)
        const frames: any[] = []
        client.on("OUTPUT_STREAM", (msg) => msg.channel === "STREAM" && frames.push(msg.data))

        toServer("OUTPUT_STREAM", { channel: "STREAM", data: { id: "output-a", sequence: 1 } })
        await waitFor(() => frames.length === 1, "Output stream did not send its first frame")
        toServer("OUTPUT_STREAM", { channel: "STREAM", data: { id: "output-a", sequence: 2 } })
        toServer("OUTPUT_STREAM", { channel: "STREAM", data: { id: "output-b", sequence: 1 } })
        await waitFor(() => frames.length === 2, "Output B was blocked by output A's pending frame")
        await new Promise((resolve) => setTimeout(resolve, 25))
        expect(frames.map((frame) => frame.id)).toEqual(["output-a", "output-b"])

        client.emit("OUTPUT_STREAM", { channel: "STREAM_DONE", data: { id: "output-a", success: true } })
        await new Promise((resolve) => setTimeout(resolve, 10))
        toServer("OUTPUT_STREAM", { channel: "STREAM", data: { id: "output-a", sequence: 3 } })
        toServer("OUTPUT_STREAM", { channel: "STREAM", data: { id: "output-b", sequence: 2 } })
        await waitFor(() => frames.length === 3, "Acknowledged output A was not released")
        await new Promise((resolve) => setTimeout(resolve, 25))
        expect(frames.map((frame) => frame.id)).toEqual(["output-a", "output-b", "output-a"])

        client.disconnect()
        await waitFor(() => getConnections("OUTPUT_STREAM") === 0, "Output stream disconnect was not observed")
        const replacement = await openSocket(ports.output_stream)
        const replacementFrames: any[] = []
        replacement.on("OUTPUT_STREAM", (msg) => msg.channel === "STREAM" && replacementFrames.push(msg.data))
        toServer("OUTPUT_STREAM", { channel: "STREAM", data: { id: "output-b", sequence: 3 } })
        await waitFor(() => replacementFrames.length === 1, "Output stream did not recover after reconnect")
    }, 10000)
})
