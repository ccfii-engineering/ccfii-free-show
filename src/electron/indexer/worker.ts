// Electron utilityProcess entry point for the file indexer.
// Communicates with the main process via process.parentPort (Electron API).

import { walkFolder } from "./DirWalker"
import { parseShowsFolder } from "./ShowParser"
import type { WorkerInit, WorkerRequest, WorkerResponse } from "./protocol"

const parentPort = process.parentPort
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
    void handle(e.data)
})

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

    if (data.type === "READ_FOLDER") {
        try {
            await walkFolder(
                {
                    paths: data.paths,
                    depth: data.depth,
                    captureFolderContent: data.captureFolderContent,
                    generateThumbnails: data.generateThumbnails,
                    batchSize: data.batchSize
                },
                (entries) => send({ type: "READ_FOLDER_BATCH", requestId: data.requestId, entries })
            )
            send({ type: "READ_FOLDER_DONE", requestId: data.requestId })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            send({ type: "ERROR", requestId: data.requestId, message })
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
        return
    }
}
