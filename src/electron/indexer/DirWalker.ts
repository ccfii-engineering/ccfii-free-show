import fs from "fs"
import path from "path"
import type { WalkBatchCallback, WalkOptions } from "./types"
import type { FileFolder } from "../../types/Main"

const DEFAULT_BATCH_SIZE = 200
const STAT_CONCURRENCY = 16

function createWalkAbortError() {
    const error = new Error("Folder scan cancelled")
    error.name = "AbortError"
    return error
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw createWalkAbortError()
}

function statAsync(filePath: string, signal?: AbortSignal): Promise<fs.Stats | null> {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stats) => {
            if (signal?.aborted) {
                reject(createWalkAbortError())
                return
            }
            resolve(err ? null : stats)
        })
    })
}

async function readdirAsync(folderPath: string, signal?: AbortSignal): Promise<string[]> {
    throwIfAborted(signal)
    return new Promise((resolve, reject) => {
        fs.readdir(folderPath, (err, names) => {
            if (signal?.aborted) reject(createWalkAbortError())
            else if (err) reject(err)
            else resolve(names)
        })
    })
}

async function statDirectoryRequiredAsync(folderPath: string, signal?: AbortSignal): Promise<fs.Stats> {
    throwIfAborted(signal)
    return new Promise((resolve, reject) => {
        fs.stat(folderPath, (err, stats) => {
            if (signal?.aborted) reject(createWalkAbortError())
            else if (err) reject(err)
            else if (!stats.isDirectory()) reject(new Error(`Folder scan root is not a directory: ${folderPath}`))
            else resolve(stats)
        })
    })
}

async function deliverBatch(batch: FileFolder[], onBatch: WalkBatchCallback, signal?: AbortSignal) {
    throwIfAborted(signal)
    const delivery = Promise.resolve().then(() => onBatch(batch))
    if (!signal) {
        await delivery
        return
    }

    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(createWalkAbortError())
        signal.addEventListener("abort", onAbort, { once: true })
    })
    try {
        await Promise.race([delivery, aborted])
    } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort)
    }
    throwIfAborted(signal)
}

export async function walkFolder(opts: WalkOptions, onBatch: WalkBatchCallback): Promise<void> {
    const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
    const signal = opts.signal
    const visited = new Set<string>()
    let buffer: FileFolder[] = []
    let flushing: Promise<void> | null = null

    const flush = async (force = false): Promise<void> => {
        if (flushing) {
            await flushing
            await flush(force)
            return
        }
        if (!buffer.length || (!force && buffer.length < batchSize)) return

        const batch = buffer.splice(0, Math.min(batchSize, buffer.length))
        const current = deliverBatch(batch, onBatch, signal)
        flushing = current
        try {
            await current
        } finally {
            if (flushing === current) flushing = null
        }

        if (buffer.length >= batchSize || (force && buffer.length)) await flush(force)
    }

    const walk = async (folderPath: string, currentDepth: number) => {
        throwIfAborted(signal)
        if (visited.has(folderPath)) return
        visited.add(folderPath)

        const exceededDepth = currentDepth > opts.depth
        const captureMode = opts.captureFolderContent && currentDepth < 2

        if (captureMode ? false : exceededDepth) {
            let shallowFiles: string[] = []
            if (currentDepth === 1) {
                const shallowNames = await readdirAsync(folderPath, signal)
                shallowFiles = shallowNames.map((name) => path.join(folderPath, name))
            }
            buffer.push({ isFolder: true, path: folderPath, name: path.basename(folderPath), files: shallowFiles })
            await flush()
            return
        }

        const names = await readdirAsync(folderPath, signal)
        const filePaths = names.map((name) => path.join(folderPath, name))
        const childDirectories: (string | undefined)[] = new Array(filePaths.length)
        let nextIndex = 0

        const statNext = async () => {
            while (true) {
                throwIfAborted(signal)
                const index = nextIndex++
                if (index >= filePaths.length) return

                const filePath = filePaths[index]
                const stats = await statAsync(filePath, signal)
                throwIfAborted(signal)
                if (!stats) continue

                if (stats.isDirectory()) {
                    childDirectories[index] = filePath
                    continue
                }

                buffer.push({ isFolder: false, path: filePath, name: path.basename(filePath), stats })
                if (buffer.length >= batchSize) await flush()
            }
        }

        const statWorkerCount = Math.min(STAT_CONCURRENCY, filePaths.length)
        await Promise.all(Array.from({ length: statWorkerCount }, () => statNext()))

        for (const childPath of childDirectories) {
            throwIfAborted(signal)
            if (childPath) await walk(childPath, currentDepth + 1)
        }

        buffer.push({ isFolder: true, path: folderPath, name: path.basename(folderPath), files: filePaths })
        if (buffer.length >= batchSize) await flush()
    }

    for (const root of opts.paths) {
        throwIfAborted(signal)
        await statDirectoryRequiredAsync(root, signal)
        await walk(root, 0)
    }

    await flush(true)
}
