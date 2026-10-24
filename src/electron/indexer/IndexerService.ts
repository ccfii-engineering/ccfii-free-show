import { app, utilityProcess, type UtilityProcess } from "electron"
import path from "path"
import { uid } from "uid"
import type { FileFolder } from "../../types/Main"
import type { TrimmedShows } from "../../types/Show"
import { getThumbnailFolderPath } from "../data/thumbnails"
import { createAbortError } from "./FolderScanScheduler"
import type { WorkerInit, WorkerRequest, WorkerResponse } from "./protocol"

type ReadFolderJob = {
    type: "READ_FOLDER"
    requestId: string
    onBatch: (entries: FileFolder[], batchSequence: number) => Promise<void> | void
    resolve: () => void
    reject: (err: Error) => void
    signal?: AbortSignal
    cleanupSignal: () => void
    batchSequence: number
    started: boolean
    cancelled: boolean
    terminalError?: Error
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
                if (job.type === "READ_FOLDER") this.finishReadFolder(job, job.terminalError || new Error(msg.message))
                else {
                    job.reject(new Error(msg.message))
                    this.jobs.delete(msg.requestId!)
                }
            } else {
                console.error("[indexer-service] worker error:", msg.message)
            }
            return
        }
        if (msg.type === "READ_FOLDER_BATCH") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type !== "READ_FOLDER") return
            if (job.cancelled || msg.batchSequence !== job.batchSequence + 1) {
                this.cancelReadFolder(job, job.terminalError || new Error("Unexpected folder batch sequence"))
                return
            }

            job.batchSequence = msg.batchSequence
            void this.deliverBatch(job, msg.entries, msg.batchSequence)
            return
        }
        if (msg.type === "READ_FOLDER_DONE" || msg.type === "READ_FOLDER_CANCELLED") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "READ_FOLDER") {
                const error = job.terminalError || (msg.type === "READ_FOLDER_CANCELLED" ? createAbortError() : undefined)
                this.finishReadFolder(job, error)
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
        }
    }

    private async deliverBatch(job: ReadFolderJob, entries: FileFolder[], batchSequence: number) {
        try {
            if (job.cancelled) return
            await job.onBatch(entries, batchSequence)
            if (job.cancelled || this.jobs.get(job.requestId) !== job) return
            this.worker?.postMessage({ type: "READ_FOLDER_BATCH_ACK", requestId: job.requestId, batchSequence })
        } catch (error) {
            this.cancelReadFolder(job, error instanceof Error ? error : new Error(String(error)))
        }
    }

    private cancelReadFolder(job: ReadFolderJob, error: Error) {
        if (!job.terminalError) job.terminalError = error
        if (job.cancelled) return
        job.cancelled = true
        if (!job.started) {
            this.finishReadFolder(job, job.terminalError)
            return
        }
        this.worker?.postMessage({ type: "CANCEL_READ_FOLDER", requestId: job.requestId })
    }

    private finishReadFolder(job: ReadFolderJob, error?: Error) {
        if (this.jobs.get(job.requestId) !== job) return
        this.jobs.delete(job.requestId)
        job.cleanupSignal()
        if (error) job.reject(error)
        else job.resolve()
    }

    private async send(req: WorkerRequest) {
        if (!this.worker) this.start()
        await this.ready
        if (req.type === "READ_FOLDER") {
            const job = this.jobs.get(req.requestId)
            if (job?.type !== "READ_FOLDER" || job.cancelled || job.signal?.aborted) {
                if (job?.type === "READ_FOLDER") this.cancelReadFolder(job, createAbortError())
                return
            }
            job.started = true
        }
        this.worker?.postMessage(req)
    }

    async readFolder(args: { paths: string[]; depth: number; captureFolderContent: boolean; generateThumbnails: boolean }, onBatch: (entries: FileFolder[], batchSequence: number) => Promise<void> | void, signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) return Promise.reject(createAbortError())
        const requestId = uid(8)
        return new Promise((resolve, reject) => {
            const onAbort = () => this.cancelReadFolder(job, createAbortError())
            const job: ReadFolderJob = {
                type: "READ_FOLDER",
                requestId,
                onBatch,
                resolve,
                reject,
                signal,
                cleanupSignal: () => signal?.removeEventListener("abort", onAbort),
                batchSequence: 0,
                started: false,
                cancelled: false
            }
            this.jobs.set(requestId, job)
            signal?.addEventListener("abort", onAbort, { once: true })
            void this.send({ type: "READ_FOLDER", requestId, ...args }).catch((error) => this.finishReadFolder(job, error instanceof Error ? error : new Error(String(error))))
        })
    }

    async parseShows(folderPath: string, chunkSize: number, onBatch: (trimmed: TrimmedShows) => void): Promise<void> {
        const requestId = uid(8)
        return new Promise((resolve, reject) => {
            this.jobs.set(requestId, { type: "PARSE_SHOWS", onBatch, resolve, reject })
            void this.send({ type: "PARSE_SHOWS", requestId, folderPath, chunkSize }).catch(reject)
        })
    }

    private failAll(err: Error) {
        for (const [, job] of this.jobs) {
            if (job.type === "READ_FOLDER") {
                job.cleanupSignal()
                job.reject(err)
            } else job.reject(err)
        }
        this.jobs.clear()
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
