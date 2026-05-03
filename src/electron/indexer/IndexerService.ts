import { app, utilityProcess, type UtilityProcess } from "electron"
import path from "path"
import { uid } from "uid"
import type { FileFolder } from "../../types/Main"
import type { TrimmedShows } from "../../types/Show"
import { getThumbnailFolderPath } from "../data/thumbnails"
import type { WorkerInit, WorkerRequest, WorkerResponse } from "./protocol"

type ReadFolderJob = {
    type: "READ_FOLDER"
    onBatch: (entries: FileFolder[]) => void
    resolve: () => void
    reject: (err: Error) => void
}
type ParseShowsJob = {
    type: "PARSE_SHOWS"
    onBatch: (trimmed: TrimmedShows) => void
    resolve: () => void
    reject: (err: Error) => void
}
type Job = ReadFolderJob | ParseShowsJob

const READY_TIMEOUT_MS = 5000

class IndexerService {
    private worker: UtilityProcess | null = null
    private ready: Promise<void> | null = null
    private readyResolve: (() => void) | null = null
    private readyReject: ((err: Error) => void) | null = null
    private jobs = new Map<string, Job>()

    start() {
        if (this.worker) return
        const workerPath = path.join(__dirname, "worker.js")
        const proc = utilityProcess.fork(workerPath, [], { stdio: "inherit" })
        this.worker = proc

        this.ready = new Promise<void>((resolve, reject) => {
            this.readyResolve = resolve
            this.readyReject = reject
            const timeout = setTimeout(() => reject(new Error("Indexer worker init timeout")), READY_TIMEOUT_MS)
            timeout.unref?.()
        })

        proc.on("message", (msg: WorkerResponse) => this.onMessage(msg))
        proc.on("exit", (code) => {
            console.error("[indexer-service] worker exited", code)
            const exitErr = new Error(`Indexer worker exited (code ${code})`)
            this.readyReject?.(exitErr)
            this.failAll(exitErr)
            this.worker = null
            this.ready = null
            this.readyResolve = null
            this.readyReject = null
        })

        const init: WorkerInit = { type: "INIT", cachePath: getThumbnailFolderPath(), appDataPath: app.getPath("userData") }
        proc.postMessage(init)
    }

    private onMessage(msg: WorkerResponse) {
        if (msg.type === "READY") {
            this.readyResolve?.()
            return
        }
        if (msg.type === "ERROR") {
            const job = msg.requestId ? this.jobs.get(msg.requestId) : null
            if (job) {
                job.reject(new Error(msg.message))
                this.jobs.delete(msg.requestId!)
            } else {
                console.error("[indexer-service] worker error:", msg.message)
            }
            return
        }
        if (msg.type === "READ_FOLDER_BATCH") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "READ_FOLDER") job.onBatch(msg.entries)
            return
        }
        if (msg.type === "READ_FOLDER_DONE") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "READ_FOLDER") {
                job.resolve()
                this.jobs.delete(msg.requestId)
            }
            return
        }
        if (msg.type === "PARSE_SHOWS_BATCH") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "PARSE_SHOWS") job.onBatch(msg.trimmed)
            return
        }
        if (msg.type === "PARSE_SHOWS_DONE") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "PARSE_SHOWS") {
                job.resolve()
                this.jobs.delete(msg.requestId)
            }
            return
        }
    }

    private failAll(err: Error) {
        for (const [, job] of this.jobs) job.reject(err)
        this.jobs.clear()
    }

    private async send(req: WorkerRequest) {
        if (!this.worker) this.start()
        await this.ready
        this.worker?.postMessage(req)
    }

    async readFolder(args: { paths: string[]; depth: number; captureFolderContent: boolean; generateThumbnails: boolean }, onBatch: (entries: FileFolder[]) => void): Promise<void> {
        const requestId = uid(8)
        return new Promise((resolve, reject) => {
            this.jobs.set(requestId, { type: "READ_FOLDER", onBatch, resolve, reject })
            void this.send({ type: "READ_FOLDER", requestId, ...args })
        })
    }

    async parseShows(folderPath: string, chunkSize: number, onBatch: (trimmed: TrimmedShows) => void): Promise<void> {
        const requestId = uid(8)
        return new Promise((resolve, reject) => {
            this.jobs.set(requestId, { type: "PARSE_SHOWS", onBatch, resolve, reject })
            void this.send({ type: "PARSE_SHOWS", requestId, folderPath, chunkSize })
        })
    }

    stop() {
        this.worker?.kill()
        this.worker = null
        this.ready = null
        this.readyResolve = null
        this.readyReject = null
        this.failAll(new Error("Indexer service stopped"))
    }
}

export const indexerService = new IndexerService()
