import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { setTimeout as delay } from "node:timers/promises"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { performance } from "node:perf_hooks"
import { execFileSync } from "node:child_process"
import ts from "typescript"
import { createAbortError, FolderScanScheduler } from "../../src/electron/indexer/FolderScanScheduler.ts"
import { walkFolder } from "../../src/electron/indexer/DirWalker.ts"

const DEFAULT_SIZES = [1000, 5000, 20000]
const BATCH_ACK_DELAY_MS = Number(process.env.MEDIA_BENCH_ACK_DELAY_MS || 2)
const MAX_DIRECTORIES = Number(process.env.MEDIA_BENCH_MAX_DIRECTORIES || 10)
const MIN_FILES_PER_DIRECTORY = 100
const require = createRequire(import.meta.url)

function parseSizes() {
    const value = process.argv.find((arg) => arg.startsWith("--sizes="))?.slice("--sizes=".length)
    if (!value) return DEFAULT_SIZES

    const sizes = value.split(",").map(Number)
    assert.ok(
        sizes.every((size) => Number.isInteger(size) && size > 0),
        "--sizes must be positive comma-separated integers"
    )
    return sizes
}

function parseModes() {
    const value = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length)
    const modes = value ? value.split(",") : ["worker-algorithm", "in-process-fallback"]
    assert.ok(
        modes.every((mode) => ["worker-algorithm", "in-process-fallback"].includes(mode)),
        "--mode must be worker-algorithm and/or in-process-fallback"
    )
    return modes
}

function loadReadFolderContent() {
    const sourcePath = path.resolve("src/electron/utils/files.ts")
    const source = fs.readFileSync(sourcePath, "utf8")
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true
        }
    }).outputText
    const module = { exports: {} }
    const noop = () => undefined
    const runtimeModules = {
        electron: { app: { getPath: () => os.tmpdir() }, dialog: {}, shell: {} },
        exif: { ExifImage: class {} },
        "../../types/Channels": { OUTPUT: "OUTPUT" },
        "../../types/IPC/Main": { Main: {} },
        "../../types/IPC/ToMain": { ToMain: {} },
        "../data/media": {
            imageExtensions: ["jpg", "jpeg", "png"],
            mimeTypes: {},
            videoExtensions: ["mp4", "mov"]
        },
        "../data/store": { _store: {}, appDataPath: "", config: {}, getStore: noop, setStore: noop, setStoreValue: noop },
        "../data/thumbnails": { createThumbnail: () => "", doesMediaExist: () => false, filePathHashCode: () => "" },
        "../indexer/IndexerService": {
            indexerService: {
                readFolder: ({ paths, depth, captureFolderContent, generateThumbnails }, onBatch, signal) => walkFolder({ paths, depth, captureFolderContent, generateThumbnails, signal }, onBatch)
            }
        },
        "../indexer/FolderScanScheduler": { createAbortError, FolderScanScheduler },
        "../indexer/DirWalker": { walkFolder },
        "../IPC/main": { sendMain: noop, sendToMain: noop },
        "../output/OutputHelper": { OutputHelper: class {} },
        "./../index": { mainWindow: null, setAutoProfile: noop, toApp: noop },
        "./shows": { getAllShows: noop, trimShow: noop }
    }

    const localRequire = (id) => {
        if (Object.hasOwn(runtimeModules, id)) return runtimeModules[id]
        return require(id)
    }
    new Function("require", "module", "exports", "__dirname", transpiled)(localRequire, module, module.exports, path.dirname(sourcePath))
    return module.exports.readFolderContent
}

function makeFixture(root, fileCount) {
    const directoryCount = Math.min(MAX_DIRECTORIES, Math.ceil(fileCount / MIN_FILES_PER_DIRECTORY))
    const filesPerDirectory = Math.ceil(fileCount / directoryCount)
    const payload = Buffer.from("freeshow-media-fixture\n")
    let written = 0
    for (let directoryIndex = 0; directoryIndex < directoryCount; directoryIndex++) {
        const directory = path.join(root, `directory-${String(directoryIndex).padStart(4, "0")}`)
        fs.mkdirSync(directory, { recursive: true })
        const count = Math.min(filesPerDirectory, fileCount - written)
        for (let index = 0; index < count; index++) {
            const extension = index % 4 === 0 ? "jpg" : index % 4 === 1 ? "mp4" : "txt"
            fs.writeFileSync(path.join(directory, `item-${String(index).padStart(4, "0")}.${extension}`), payload)
        }
        written += count
    }
    return { fileCount: written, directoryCount, filesPerDirectory }
}

function monitorFileSystem() {
    const metrics = { statCount: 0, statMs: 0, maxStatInFlight: 0, readdirCount: 0, readdirMs: 0, activeStats: 0 }
    const originalStat = fs.stat
    const originalReaddir = fs.readdir
    fs.stat = function (...args) {
        const callbackIndex = args.length - 1
        const callback = args[callbackIndex]
        if (typeof callback !== "function") return originalStat.apply(this, args)
        const started = performance.now()
        metrics.activeStats++
        metrics.maxStatInFlight = Math.max(metrics.maxStatInFlight, metrics.activeStats)
        args[callbackIndex] = (...result) => {
            metrics.statCount++
            metrics.statMs += performance.now() - started
            metrics.activeStats--
            callback(...result)
        }
        return originalStat.apply(this, args)
    }
    fs.readdir = function (...args) {
        const callbackIndex = args.length - 1
        const callback = args[callbackIndex]
        if (typeof callback !== "function") return originalReaddir.apply(this, args)
        const started = performance.now()
        args[callbackIndex] = (...result) => {
            metrics.readdirCount++
            metrics.readdirMs += performance.now() - started
            callback(...result)
        }
        return originalReaddir.apply(this, args)
    }
    return () => {
        fs.stat = originalStat
        fs.readdir = originalReaddir
        return metrics
    }
}

function memorySnapshot() {
    const memory = process.memoryUsage()
    return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, externalBytes: memory.external }
}

async function runFixture(readFolderContent, fixture, mode) {
    if (global.gc) global.gc()
    const root = fixture.root
    const rendererEntries = new Map()
    const pendingRendererBatches = new Set()
    const measurements = {
        firstBatchMs: null,
        rendererMergeFilterMs: 0,
        serializedBatchBytes: 0,
        batches: 0,
        entriesReceived: 0,
        mediaEntriesReceived: 0,
        peakPendingRendererBatches: 0
    }
    const baselineMemory = memorySnapshot()
    const peakMemory = { ...baselineMemory }
    const scanStarted = performance.now()
    const stopMemorySampling = setInterval(() => {
        const now = memorySnapshot()
        peakMemory.rssBytes = Math.max(peakMemory.rssBytes, now.rssBytes)
        peakMemory.heapUsedBytes = Math.max(peakMemory.heapUsedBytes, now.heapUsedBytes)
        peakMemory.externalBytes = Math.max(peakMemory.externalBytes, now.externalBytes)
    }, 5)
    const restoreFileSystem = monitorFileSystem()
    const onBatch = (batch) => {
        const receivedAt = performance.now()
        if (measurements.firstBatchMs === null) measurements.firstBatchMs = receivedAt - scanStarted
        measurements.batches++
        measurements.entriesReceived += batch.length
        const encoded = JSON.stringify(batch)
        measurements.serializedBatchBytes += Buffer.byteLength(encoded)
        const copied = JSON.parse(encoded)
        const task = (async () => {
            if (BATCH_ACK_DELAY_MS) await delay(BATCH_ACK_DELAY_MS)
            const mergeStarted = performance.now()
            for (const entry of copied) {
                rendererEntries.set(entry.path, entry)
                if (!entry.isFolder && /\.(jpg|jpeg|png|mp4|mov)$/i.test(entry.name)) measurements.mediaEntriesReceived++
            }
            measurements.rendererMergeFilterMs += performance.now() - mergeStarted
        })()
        pendingRendererBatches.add(task)
        measurements.peakPendingRendererBatches = Math.max(measurements.peakPendingRendererBatches, pendingRendererBatches.size)
        void task.finally(() => pendingRendererBatches.delete(task))
        return task
    }

    let result
    let scanError = null
    const streamingRequest = !process.argv.includes("--legacy")
    try {
        result = await readFolderContent({ path: root, depth: 1, useWorker: mode === "worker-algorithm", ...(streamingRequest ? { requestId: "media-benchmark" } : {}) }, onBatch)
    } catch (error) {
        scanError = error instanceof Error ? error.message : String(error)
    }
    const scanFinishedAt = performance.now()
    const scanDurationMs = scanFinishedAt - scanStarted
    await Promise.allSettled([...pendingRendererBatches])
    clearInterval(stopMemorySampling)
    const fsMetrics = restoreFileSystem()
    const rendererCompleteAt = performance.now()
    const resultEntryCount = result && typeof result === "object" ? Object.keys(result).length : null

    return {
        fixture: { files: fixture.fileCount, directories: fixture.directoryCount },
        mode,
        requestMode: streamingRequest ? "streaming" : "legacy-non-streaming",
        batchAckDelayMs: BATCH_ACK_DELAY_MS,
        scanDurationMs: Number(scanDurationMs.toFixed(2)),
        rendererCompletionMs: Number((rendererCompleteAt - scanStarted).toFixed(2)),
        firstUsefulBatchMs: measurements.firstBatchMs === null ? null : Number(measurements.firstBatchMs.toFixed(2)),
        enumerationStat: {
            statCount: fsMetrics.statCount,
            totalStatCallbackMs: Number(fsMetrics.statMs.toFixed(2)),
            maxConcurrentStats: fsMetrics.maxStatInFlight,
            readdirCount: fsMetrics.readdirCount,
            totalReaddirCallbackMs: Number(fsMetrics.readdirMs.toFixed(2))
        },
        transferAndRendererSimulation: {
            batches: measurements.batches,
            entriesReceived: measurements.entriesReceived,
            jsonPayloadBytes: measurements.serializedBatchBytes,
            mergedRendererEntries: rendererEntries.size,
            mediaEntriesReceived: measurements.mediaEntriesReceived,
            mergeFilterCpuMs: Number(measurements.rendererMergeFilterMs.toFixed(2)),
            peakPendingBatches: measurements.peakPendingRendererBatches
        },
        retainedResultEntries: resultEntryCount,
        memory: {
            baselineMainProcess: baselineMemory,
            peakObservedMainProcess: peakMemory,
            rendererIsSimulatedInMainProcess: true,
            separateRendererMemory: "not measured"
        },
        thumbnailWork: "not measured (disabled; no thumbnail generation in this harness)",
        error: scanError
    }
}

async function main() {
    const sizes = parseSizes()
    const modes = parseModes()
    assert.ok(Number.isInteger(MAX_DIRECTORIES) && MAX_DIRECTORIES > 0, "MEDIA_BENCH_MAX_DIRECTORIES must be a positive integer")
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "freeshow-media-bench-"))
    const readFolderContent = loadReadFolderContent()
    const results = []
    try {
        for (const size of sizes) {
            const root = path.join(tempRoot, `fixture-${size}`)
            fs.mkdirSync(root)
            const fixture = { root, ...makeFixture(root, size) }
            for (const mode of modes) {
                results.push(await runFixture(readFolderContent, fixture, mode))
            }
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true })
    }

    const host = {
        date: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform} ${os.release()} ${process.arch}`,
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytesAtEnd: os.freemem(),
        gitHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        fixture: { maxDirectories: MAX_DIRECTORIES, minFilesPerDirectory: MIN_FILES_PER_DIRECTORY, filePayloadBytes: Buffer.byteLength("freeshow-media-fixture\n"), depth: 1 },
        limitations: ["worker-algorithm mode calls the production DirWalker in the benchmark process; it does not launch Electron utilityProcess", "batch transfer is JSON serialization plus an artificial renderer ACK delay, not Electron IPC timing", "renderer merge/filter is simulated in this Node process; there is no DOM render or separate renderer memory measurement", "thumbnail generation and capture-folder mode are not measured"]
    }
    const output = { host, results }
    const outputPath = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
    const json = JSON.stringify(output, null, 2) + "\n"
    if (outputPath) fs.writeFileSync(outputPath, json)
    process.stdout.write(json)
}

await main()
