import fs from "fs"
import path from "path"
import { Worker } from "worker_threads"

export const POWERPOINT_ARCHIVE_LIMITS = {
    maxSourceBytes: 100 * 1024 * 1024,
    maxEntries: 10_000,
    maxEntryBytes: 64 * 1024 * 1024,
    maxInflatedBytes: 512 * 1024 * 1024,
    maxSlides: 500,
    maxImagePixels: 40_000_000,
    maxTotalImagePixels: 160_000_000,
    timeoutMs: 60_000
} as const

function abortError() {
    const error = new Error("PowerPoint import cancelled")
    error.name = "AbortError"
    return error
}

export async function preflightPowerPointArchive(sourcePath: string, signal?: AbortSignal) {
    const stat = await fs.promises.stat(sourcePath)
    if (!stat.isFile()) throw new Error("The PowerPoint source is not a regular file")
    if (stat.size > POWERPOINT_ARCHIVE_LIMITS.maxSourceBytes) throw new Error("This .pptx file is larger than the 100 MiB import limit")
    if (signal?.aborted) throw abortError()

    const worker = new Worker(path.join(__dirname, "powerpointArchiveWorker.js"), {
        workerData: { sourcePath, limits: POWERPOINT_ARCHIVE_LIMITS }
    })

    return new Promise<{ pageCount: number }>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error, value?: { pageCount: number }) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            signal?.removeEventListener("abort", abort)
            if (error) reject(error)
            else resolve(value!)
        }
        const abort = () => {
            void worker.terminate()
            finish(abortError())
        }
        const timeout = setTimeout(() => {
            void worker.terminate()
            finish(new Error("The .pptx archive could not be checked within 60 seconds"))
        }, POWERPOINT_ARCHIVE_LIMITS.timeoutMs)

        worker.once("message", (message: { pageCount?: number; error?: string }) => {
            if (message?.error) finish(new Error(message.error))
            else if (Number.isInteger(message?.pageCount) && message.pageCount! > 0) finish(undefined, { pageCount: message.pageCount! })
            else finish(new Error("The .pptx archive did not contain any slides"))
        })
        worker.once("error", (error) => finish(error))
        worker.once("exit", (code) => {
            if (!settled && code !== 0) finish(new Error("The .pptx archive checker stopped unexpectedly"))
        })

        signal?.addEventListener("abort", abort, { once: true })
        if (signal?.aborted) abort()
    })
}
