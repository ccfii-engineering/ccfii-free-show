import fs from "fs"
import path from "path"
import type { FileFolder } from "../../types/Main"
import type { WalkBatchCallback, WalkOptions } from "./types"

const DEFAULT_BATCH_SIZE = 200
const STAT_CONCURRENCY = 16

function statAsync(p: string): Promise<fs.Stats | null> {
    return new Promise((resolve) => fs.stat(p, (err, stats) => resolve(err ? null : stats)))
}

function readdirAsync(p: string): Promise<string[]> {
    return new Promise((resolve) => fs.readdir(p, (err, names) => resolve(err ? [] : names)))
}

class Semaphore {
    private inflight = 0
    private queue: (() => void)[] = []
    private limit: number
    constructor(limit: number) {
        this.limit = limit
    }
    async acquire() {
        if (this.inflight < this.limit) {
            this.inflight++
            return
        }
        await new Promise<void>((resolve) => this.queue.push(resolve))
        this.inflight++
    }
    release() {
        this.inflight--
        const next = this.queue.shift()
        if (next) next()
    }
}

export async function walkFolder(opts: WalkOptions, onBatch: WalkBatchCallback): Promise<void> {
    const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
    const sem = new Semaphore(STAT_CONCURRENCY)
    const visited = new Set<string>()
    let buffer: FileFolder[] = []

    const flush = async (force = false) => {
        if (!buffer.length) return
        if (!force && buffer.length < batchSize) return
        const out = buffer
        buffer = []
        onBatch(out)
        await new Promise<void>((r) => setImmediate(r))
    }

    const walk = async (folderPath: string, currentDepth: number) => {
        if (visited.has(folderPath)) return
        visited.add(folderPath)

        const exceededDepth = currentDepth > opts.depth
        const captureMode = opts.captureFolderContent && currentDepth < 2

        if (captureMode ? false : exceededDepth) {
            let shallowFiles: string[] = []
            if (currentDepth === 1) {
                const shallowNames = await readdirAsync(folderPath)
                shallowFiles = shallowNames.map((n) => path.join(folderPath, n))
            }
            buffer.push({ isFolder: true, path: folderPath, name: path.basename(folderPath), files: shallowFiles })
            await flush()
            return
        }

        const names = await readdirAsync(folderPath)
        const filePaths = names.map((n) => path.join(folderPath, n))

        const childPromises: Promise<void>[] = []
        for (const filePath of filePaths) {
            await sem.acquire()
            childPromises.push(
                (async () => {
                    try {
                        const stats = await statAsync(filePath)
                        if (!stats) return
                        if (stats.isDirectory()) {
                            await walk(filePath, currentDepth + 1)
                        } else {
                            buffer.push({ isFolder: false, path: filePath, name: path.basename(filePath), stats })
                            if (buffer.length >= batchSize) await flush()
                        }
                    } finally {
                        sem.release()
                    }
                })()
            )
        }
        await Promise.all(childPromises)

        buffer.push({ isFolder: true, path: folderPath, name: path.basename(folderPath), files: filePaths })
        if (buffer.length >= batchSize) await flush()
    }

    for (const root of opts.paths) {
        const stats = await statAsync(root)
        if (!stats?.isDirectory()) continue
        await walk(root, 0)
    }

    await flush(true)
}
