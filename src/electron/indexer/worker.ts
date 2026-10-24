// Electron utilityProcess entry point for the file indexer.
// Communicates with the main process via process.parentPort (Electron API).

import { walkFolder } from "./DirWalker"
import { parseShowsFolder } from "./ShowParser"
import { createAbortError } from "./FolderScanScheduler"
import type { WorkerInit, WorkerRequest, WorkerResponse } from "./protocol"

const parentPort = process.parentPort
type BatchWaiter = { resolve: () => void; reject: (error: Error) => void; cleanup: () => void }
const folderControllers = new Map<string, AbortController>()
const batchWaiters = new Map<string, Map<number, BatchWaiter>>()
let initialized = false

function send(msg: WorkerResponse) {
    parentPort?.postMessage(msg)
}

if (!parentPort) {
    // Defensive: utility process must always have a parent port.
    // eslint-disable-next-line no-console
    console.error("[indexer-worker] No parentPort available; exiting.")
    process.exit(1)
}

parentPort.on("message", (e: { data: WorkerInit | WorkerRequest }) => {
    const data = e.data
    if (data.type === "READ_FOLDER_BATCH_ACK") {
        const waiter = batchWaiters.get(data.requestId)?.get(data.batchSequence)
        waiter?.resolve()
        return
    }
    if (data.type === "CANCEL_READ_FOLDER") {
        folderControllers.get(data.requestId)?.abort()
        return
    }
    void handle(data)
})

function waitForBatchAck(requestId: string, batchSequence: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const waiters = batchWaiters.get(requestId) || new Map<number, BatchWaiter>()
        batchWaiters.set(requestId, waiters)

        const cleanup = () => {
            signal.removeEventListener("abort", onAbort)
            waiters.delete(batchSequence)
            if (!waiters.size && batchWaiters.get(requestId) === waiters) batchWaiters.delete(requestId)
        }
        const onAbort = () => {
            cleanup()
            reject(createAbortError())
        }
        const waiter: BatchWaiter = {
            resolve: () => {
                cleanup()
                resolve()
            },
            reject: (error) => {
                cleanup()
                reject(error)
            },
            cleanup
        }

        if (signal.aborted) {
            reject(createAbortError())
            return
        }
        waiters.set(batchSequence, waiter)
        signal.addEventListener("abort", onAbort, { once: true })
    })
}

async function handle(data: WorkerInit | WorkerRequest) {
    if (!initialized) {
        if (data.type !== "INIT") {
            send({ type: "ERROR", message: "Worker not initialized" })
            return
        }
        initialized = true
        send({ type: "READY" })
        return
    }

    if (data.type === "INIT") return

    if (data.type === "READ_FOLDER") {
        const controller = new AbortController()
        folderControllers.set(data.requestId, controller)
        let batchSequence = 0
        try {
            await walkFolder(
                {
                    paths: data.paths,
                    depth: data.depth,
                    captureFolderContent: data.captureFolderContent,
                    generateThumbnails: data.generateThumbnails,
                    batchSize: data.batchSize,
                    signal: controller.signal
                },
                async (entries) => {
                    const sequence = ++batchSequence
                    send({ type: "READ_FOLDER_BATCH", requestId: data.requestId, batchSequence: sequence, entries })
                    await waitForBatchAck(data.requestId, sequence, controller.signal)
                }
            )
            send({ type: "READ_FOLDER_DONE", requestId: data.requestId })
        } catch (err: unknown) {
            if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
                send({ type: "READ_FOLDER_CANCELLED", requestId: data.requestId })
            } else {
                const message = err instanceof Error ? err.message : String(err)
                send({ type: "ERROR", requestId: data.requestId, message })
            }
        } finally {
            folderControllers.delete(data.requestId)
            const waiters = batchWaiters.get(data.requestId)
            for (const waiter of waiters?.values() || []) waiter.reject(createAbortError())
            batchWaiters.delete(data.requestId)
        }
        return
    }

    if (data.type === "PARSE_SHOWS") {
        try {
            await parseShowsFolder(data.folderPath, { chunkSize: data.chunkSize }, (trimmed) => send({ type: "PARSE_SHOWS_BATCH", requestId: data.requestId, trimmed }))
            send({ type: "PARSE_SHOWS_DONE", requestId: data.requestId })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            send({ type: "ERROR", requestId: data.requestId, message })
        }
    }
}
