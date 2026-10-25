import { ipcMain, type IpcMainEvent } from "electron"
import type { Response } from "express"
import express from "express"
import http from "http"
import { join } from "path"
import { Server, type Socket } from "socket.io"
import type { Main, MainSendPayloads } from "../types/IPC/Main"
import type { Message, ServerData } from "../types/Socket"
import { CaptureHelper } from "./capture/CaptureHelper"
import { publishPort, unpublishPorts } from "./data/bonjour"
import { toApp } from "./index"
import { OutputHelper } from "./output/OutputHelper"

type ServerName = "REMOTE" | "STAGE" | "CONTROLLER" | "OUTPUT_STREAM"
interface ServerValues {
    port: number
    server: http.Server
    io: Server
    max: number
    connections: { [key: string]: { name: string } }
    data: ServerData
}

const serverPorts: { [key in ServerName]: number } = {
    REMOTE: 5510,
    STAGE: 5511,
    CONTROLLER: 5512,
    OUTPUT_STREAM: 5513
    // CAM: 5513,
}

const servers: { [key in ServerName]?: ServerValues } = {}
const ioServers: { [key in ServerName]?: Server } = {}

const SERVER_CLOSE_TIMEOUT_MS = 5000
type ServerConfiguration = MainSendPayloads[Main.SERVER_DATA]
interface LifecycleRequest {
    revision: number
    configuration?: ServerConfiguration
}

let lifecycleRevision = 0
let settledRevision = 0
let desiredLifecycle: LifecycleRequest = { revision: 0 }
let lifecycleWorker: Promise<void> | undefined
let latestLifecycleCompletion: { revision: number; resolve: () => void; reject: (error: Error) => void } | undefined
const serverCloseOperations = new WeakMap<ServerValues, Promise<void>>()

// STAGE clients with a visible "current output" mirror subscribe to frame pushes (renewed by heartbeat)
// declared before createServers() below, which resets it when the STAGE server instance is (re)created
const STAGE_STREAM_SUBSCRIPTION_TTL = 10000
let stageStreamSubscribers: { [socketId: string]: number } = {} // socketId: expiry time

createServers()
function createServers() {
    const serverList = Object.keys(serverPorts) as ServerName[]
    serverList.forEach((id) => {
        createServerInstance(id)
        // the app -> client IPC bridge is registered once and always emits via the current io instance
        registerIpcBridge(id)
    })
}

// (re)create a fresh express app + http server + socket.io instance.
// a closed http.Server cannot be re-listened, so this is called again on every (re)start.
function createServerInstance(id: ServerName) {
    const app = express()
    const server = http.createServer(app)

    if (id === "STAGE") {
        // app.get('/show/:showId/:slideId', handleShowSlideHtmlRequest);
        // Serve media files
        // app.get('/media/:token', handleMediaRequest);
    }

    // The join import from 'path' is still needed for this part
    app.get("/", (_req, res: Response) => res.sendFile(join(__dirname, id.toLowerCase(), "index.html")))
    // The join import from 'path' is still needed for this part
    app.use(express.static(join(__dirname, id.toLowerCase())))

    const io = new Server(server)

    servers[id] = {
        ...servers[id],
        port: serverPorts[id],
        server,
        io,
        max: servers[id]?.max ?? 10,
        connections: {}, // always start with a clean connection map
        data: servers[id]?.data ?? {}
    }
    ioServers[id] = io
    if (id === "STAGE") stageStreamSubscribers = {}

    const instance = servers[id]!
    // RECEIVE CONNECTION FROM CLIENT
    io.on("connection", (socket) => {
        if (Object.keys(instance.connections).length >= instance.max) {
            io.emit(id, { channel: "ERROR", id: "overLimit", data: instance.max })
            socket.disconnect()
            return
        }

        initialize(id, socket, instance)
    })
}

function registerIpcBridge(id: ServerName) {
    // SEND DATA FROM APP TO CLIENT (uses the current io instance via ioServers, so it survives server recreation)
    ipcMain.on(id, (_e: IpcMainEvent, msg: Message) => {
        const io = ioServers[id]
        if (!io) return
        if (msg?.id) io.to(msg.id).emit(id, msg)
        else io.emit(id, msg)
    })
}

export function startServers(configuration: ServerConfiguration): Promise<void> {
    return requestServerLifecycle({
        ports: { ...configuration.ports },
        max: configuration.max,
        disabled: { ...configuration.disabled },
        data: { ...configuration.data }
    })
}

export function updateServerData(data: { [key: string]: ServerData }) {
    const serverList = Object.keys(servers) as ServerName[]
    serverList.forEach((id: ServerName) => {
        servers[id]!.data = data[id.toLowerCase()] || {}
    })
}

export function getServerData(id: ServerName) {
    return servers[id]?.data || {}
}

export function closeServers(): Promise<void> {
    return requestServerLifecycle(undefined).catch((error) => {
        console.error("Failed to stop distribution servers", error)
    })
}

function requestServerLifecycle(configuration?: ServerConfiguration): Promise<void> {
    const revision = ++lifecycleRevision
    desiredLifecycle = { revision, configuration }
    latestLifecycleCompletion?.resolve()

    const completion = new Promise<void>((resolve, reject) => {
        latestLifecycleCompletion = { revision, resolve, reject }
    })
    ensureLifecycleWorker()
    return completion
}

function ensureLifecycleWorker() {
    if (lifecycleWorker) return

    let worker: Promise<void>
    worker = processLifecycleRequests()
        .catch(async (error) => {
            console.error("Server lifecycle operation failed", error)
            try {
                await closeCurrentServerInstances()
            } catch (closeError) {
                console.error("Failed to clean up server instances after lifecycle error", closeError)
            }
            const revision = desiredLifecycle.revision
            settledRevision = revision
            rejectLatestLifecycleCompletion(revision, error as Error)
        })
        .finally(() => {
            if (lifecycleWorker !== worker) return
            lifecycleWorker = undefined
            // A request can arrive while processLifecycleRequests is settling. Start another
            // bounded worker if it was not included in the worker's final iteration.
            if (settledRevision < desiredLifecycle.revision) ensureLifecycleWorker()
        })
    lifecycleWorker = worker
}

async function processLifecycleRequests() {
    while (settledRevision < desiredLifecycle.revision) {
        const request = desiredLifecycle
        const didClose = await closeCurrentServerInstances()
        if (!didClose) {
            // Fail closed. A later explicit request can retry the still-pending close,
            // but a timeout alone never permits a replacement listener.
            settledRevision = desiredLifecycle.revision
            rejectLatestLifecycleCompletion(settledRevision, new Error("Server close was not confirmed; replacement listeners were skipped"))
            return
        }

        if (request.revision !== desiredLifecycle.revision) continue

        if (request.configuration) {
            try {
                await listenConfiguredServers({ ...request, configuration: request.configuration })
            } catch (error) {
                const cleanupSucceeded = await closeCurrentServerInstances()
                if (request.revision !== desiredLifecycle.revision) {
                    if (!cleanupSucceeded) {
                        settledRevision = desiredLifecycle.revision
                        rejectLatestLifecycleCompletion(settledRevision, new Error("Server startup was superseded, and partial listeners could not be confirmed closed"))
                        return
                    }
                    continue
                }

                settledRevision = request.revision
                const failure = cleanupSucceeded ? (error as Error) : new Error(`Server startup failed and partial listeners could not be confirmed closed: ${String(error)}`)
                rejectLatestLifecycleCompletion(request.revision, failure)
                return
            }
        }

        if (request.revision !== desiredLifecycle.revision) continue
        settledRevision = request.revision
        resolveLatestLifecycleCompletion(settledRevision)
    }
}

function resolveLatestLifecycleCompletion(revision: number) {
    if (latestLifecycleCompletion?.revision !== revision) return
    latestLifecycleCompletion.resolve()
    latestLifecycleCompletion = undefined
}

function rejectLatestLifecycleCompletion(revision: number, error: Error) {
    if (latestLifecycleCompletion?.revision !== revision) return
    latestLifecycleCompletion.reject(error)
    latestLifecycleCompletion = undefined
}

async function closeCurrentServerInstances(): Promise<boolean> {
    unpublishPorts()
    const currentInstances = (Object.keys(serverPorts) as ServerName[]).map((id) => ({ id, instance: servers[id] })).filter((entry): entry is { id: ServerName; instance: ServerValues } => !!entry.instance)
    const results = await Promise.all(currentInstances.map(({ id, instance }) => closeServerInstance(id, instance)))
    if (results.some((closed) => !closed)) return false

    for (const { id, instance } of currentInstances) {
        if (servers[id] !== instance) continue
        instance.connections = {}
        if (ioServers[id] === instance.io) ioServers[id] = undefined
    }
    return true
}

function closeServerInstance(id: ServerName, instance: ServerValues): Promise<boolean> {
    let closeOperation = serverCloseOperations.get(instance)
    if (!closeOperation) {
        closeOperation = new Promise<void>((resolve, reject) => {
            let completed = false
            const finish = (error?: Error) => {
                if (completed) return
                completed = true
                if (error && !((error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING" && !instance.server.listening)) reject(error)
                else if (instance.server.listening) reject(new Error(`${id} server close callback ran while the listener remained active`))
                else resolve()
            }

            try {
                void instance.io.close(finish).catch((error) => finish(error))
            } catch (error) {
                finish(error as Error)
            }
        })
        serverCloseOperations.set(instance, closeOperation)
    }

    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
            console.error(`${id} server close timed out; replacement listener was not started`)
            resolve(false)
        }, SERVER_CLOSE_TIMEOUT_MS)
        closeOperation!.then(
            () => {
                clearTimeout(timeout)
                resolve(true)
            },
            (error) => {
                clearTimeout(timeout)
                console.error(`${id} server close failed; replacement listener was not started`, error)
                resolve(false)
            }
        )
    })
}

async function listenConfiguredServers(request: LifecycleRequest & { configuration: ServerConfiguration }) {
    const { ports, max, disabled, data } = request.configuration
    const serverList = Object.keys(serverPorts) as ServerName[]
    const listening = serverList.flatMap((id) => {
        if (disabled[id.toLowerCase()] !== false) return []

        createServerInstance(id)
        const instance = servers[id]!
        instance.max = max
        if (ports[id.toLowerCase()]) instance.port = ports[id.toLowerCase()]
        instance.data = data[id.toLowerCase()] || {}

        return [listenServer(id, instance, request.revision)]
    })

    const results = await Promise.allSettled(listening)
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
    if (failure) throw failure.reason
}

function listenServer(id: ServerName, instance: ServerValues, revision: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const onError = (error: Error) => {
            if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") console.error(`${id} server port ${instance.port} already in use`)
            else {
                console.error(`${id} server failed to listen on port ${instance.port}`, error)
                reject(error)
                return
            }
            resolve()
        }
        instance.server.once("error", onError)
        try {
            instance.server.listen(instance.port, () => {
                instance.server.off("error", onError)
                if (servers[id] !== instance || desiredLifecycle.revision !== revision || !desiredLifecycle.configuration) return resolve()

                console.info(id + " on: " + instance.port.toString())
                publishPort(id, instance.port)
                resolve()
            })
        } catch (error) {
            instance.server.off("error", onError)
            reject(error)
        }
    })
}

let responded: { [key: string]: boolean } = {}
export function toServer(id: ServerName, msg: any) {
    if (msg.channel === "STREAM") {
        // only send if responded
        if (responded[msg.data.id] === false) return
        responded[msg.data.id] = false
    }

    ioServers[id]?.emit(id, msg)
}

export function getConnections(id: ServerName) {
    return Object.keys(servers[id]?.connections || {}).length
}

export function isServerConnectionActive(id: ServerName, socketId: string) {
    return !!servers[id]?.connections[socketId]
}

// Stage Stream
function updateStageStreamSubscription(socketId: string, channel: string) {
    if (channel === "STREAM_SUBSCRIBE") stageStreamSubscribers[socketId] = Date.now() + STAGE_STREAM_SUBSCRIPTION_TTL
    else if (channel === "STREAM_UNSUBSCRIBE") delete stageStreamSubscribers[socketId]
}
export function getStageStreamSubscriberIds(): string[] {
    const now = Date.now()
    for (const id in stageStreamSubscribers) if (stageStreamSubscribers[id] < now) delete stageStreamSubscribers[id]
    return Object.keys(stageStreamSubscribers)
}
// send only to subscribed sockets - text-only stage clients should never receive frame data
export function toStageStreamSubscribers(msg: any) {
    const io = ioServers.STAGE
    if (io) getStageStreamSubscriberIds().forEach((id) => io.to(id).emit("STAGE", msg))
}

// FUNCTIONS

function initialize(id: ServerName, socket: Socket, instance: ServerValues) {
    const name: string = getOS(socket.handshake.headers["user-agent"] || "")
    toApp(id, { channel: "CONNECTION", id: socket.id, data: { name } })
    instance.connections[socket.id] = { name }

    // reset with new connection
    if (id === "OUTPUT_STREAM") responded = {}

    // SEND DATA FROM CLIENT TO APP
    socket.on(id, async (msg: Message) => {
        if (msg.channel === "STREAM_DONE") {
            responded[msg.data.id] = true
        } else if (msg.channel === "OUTPUT_FRAME") {
            const window = OutputHelper.getOutput(msg.data.outputId)?.window
            if (!window || window.isDestroyed()) return

            const frame = await CaptureHelper.captureBase64Frame(window)
            if (window.isDestroyed()) return

            const bounds = window.getBounds()
            toServer(id, { channel: "OUTPUT_FRAME", data: { frame, width: bounds.width, height: bounds.height } })
        } else if (msg) {
            if (msg.channel === "CONNECTION" || msg.channel === "DISCONNECT") return
            if (id === "STAGE") updateStageStreamSubscription(socket.id, msg.channel)
            toApp(id, { ...msg, id: socket.id })
        }
    })

    // DISCONNECT
    socket.on("disconnect", () => disconnect(id, socket, instance))
}

function disconnect(id: ServerName, socket: Socket, instance: ServerValues) {
    toApp(id, { channel: "DISCONNECT", id: socket.id })
    delete instance.connections[socket.id]
    if (id === "STAGE" && servers[id] === instance) delete stageStreamSubscribers[socket.id]
}

// https://stackoverflow.com/a/59706252
const device: { [key: string]: RegExp } = {
    "Generic Linux": /Linux/i,
    Android: /Android/i,
    BlackBerry: /BlackBerry/i,
    Bluebird: /EF500/i,
    "Chrome OS": /CrOS/i,
    Datalogic: /DL-AXIS/i,
    Honeywell: /CT50/i,
    iPad: /iPad/i,
    iPhone: /iPhone/i,
    iPod: /iPod/i,
    macOS: /Macintosh/i,
    Windows: /IEMobile|Windows/i,
    Zebra: /TC70|TC55/i
}
export function getOS(ua: string) {
    return Object.keys(device).find((v) => ua.match(device[v])) || "Unknown"
}
