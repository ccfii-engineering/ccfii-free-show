import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import ts from "typescript"
import { createAbortError, FolderScanQueueFullError, FolderScanScheduler } from "../../src/electron/indexer/FolderScanScheduler.ts"
import { walkFolder } from "../../src/electron/indexer/DirWalker.ts"
import { matchesFolderBatchAck } from "../../src/electron/indexer/folderBatchAck.ts"
import { classifyFolderBatch, getFolderScanViewOutcome } from "../../src/frontend/components/drawer/media/scanOutcome.ts"

function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

function loadReadFolderContent() {
    const sourcePath = path.resolve("src/electron/utils/files.ts")
    const source = readFileSync(sourcePath, "utf8")
    const transpiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText
    const module = { exports: {} }
    const noop = () => undefined
    const runtimeModules = {
        electron: { app: { getPath: () => os.tmpdir() }, dialog: {}, shell: {} },
        exif: { ExifImage: class {} },
        "../../types/Channels": { OUTPUT: "OUTPUT" },
        "../../types/IPC/Main": { Main: {} },
        "../../types/IPC/ToMain": { ToMain: {} },
        "../data/media": { imageExtensions: ["jpg"], mimeTypes: {}, videoExtensions: ["mp4"] },
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
    const localRequire = (id) => (Object.hasOwn(runtimeModules, id) ? runtimeModules[id] : createRequire(import.meta.url)(id))
    new Function("require", "module", "exports", "__dirname", transpiled)(localRequire, module, module.exports, path.dirname(sourcePath))
    return module.exports.readFolderContent
}

const readFolderContent = loadReadFolderContent()

async function makeFixture(directoryCount, filesPerDirectory) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "media-folder-scan-"))
    for (let directory = 0; directory < directoryCount; directory++) {
        const directoryPath = path.join(root, `directory-${directory}`)
        await fs.mkdir(directoryPath)
        for (let file = 0; file < filesPerDirectory; file++) {
            await fs.writeFile(path.join(directoryPath, `file-${file}.jpg`), "fixture")
        }
    }
    return root
}

async function makeEmptyFixture() {
    return fs.mkdtemp(path.join(os.tmpdir(), "media-folder-empty-"))
}

test("walkFolder completes the 50-directory fixture that deadlocked under recursive semaphore ownership", { timeout: 30000 }, async (t) => {
    const root = await makeFixture(50, 100)
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    let fileCount = 0
    let folderCount = 0
    await walkFolder({ paths: [root], depth: 1, captureFolderContent: false, batchSize: 200 }, (batch) => {
        for (const entry of batch) {
            if (entry.isFolder) folderCount++
            else fileCount++
        }
    })

    assert.equal(fileCount, 5000)
    assert.equal(folderCount, 51)
})

test("worker and fallback scans fail when the requested root is missing", async (t) => {
    const parent = await makeEmptyFixture()
    t.after(() => fs.rm(parent, { recursive: true, force: true }))
    const missingRoot = path.join(parent, "disconnected-root")

    for (const useWorker of [true, false]) {
        const receivedEntries = []
        const originalConsoleError = console.error
        console.error = () => undefined
        try {
            await assert.rejects(
                readFolderContent({ path: missingRoot, depth: 1, requestId: `missing-${useWorker}`, useWorker }, (batch) => receivedEntries.push(...batch)),
                { code: "ENOENT" }
            )
        } finally {
            console.error = originalConsoleError
        }
        assert.equal(receivedEntries.length, 0)
    }
})

test("worker and fallback scans reject mixed roots after delivering valid-root batches", { timeout: 15000 }, async (t) => {
    const root = await makeFixture(1, 205)
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const missingRoot = path.join(root, "disconnected-root")

    for (const useWorker of [true, false]) {
        const receivedEntries = []
        await assert.rejects(
            readFolderContent({ path: [root, missingRoot], depth: 1, requestId: `mixed-${useWorker}`, useWorker }, (batch) => receivedEntries.push(...batch)),
            { code: "ENOENT" }
        )
        assert.ok(receivedEntries.length >= 200, `expected delivered entries for useWorker=${useWorker}`)
        assert.ok(receivedEntries.some((entry) => entry.path.startsWith(root + path.sep)))
    }
})

test("worker and fallback scans complete an accessible empty root", async (t) => {
    const root = await makeEmptyFixture()
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    for (const useWorker of [true, false]) {
        const receivedEntries = []
        const result = await readFolderContent({ path: root, depth: 1, requestId: `empty-${useWorker}`, useWorker }, (batch) => receivedEntries.push(...batch))
        assert.deepEqual(result, { status: "complete", entryCount: 1 })
        assert.equal(receivedEntries.length, 1)
        assert.equal(receivedEntries[0].path, root)
        assert.equal(receivedEntries[0].isFolder, true)
    }
})

test("walkFolder waits for one batch ACK before emitting the next batch", async (t) => {
    const root = await makeFixture(2, 20)
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    let activeDeliveries = 0
    let peakDeliveries = 0
    let batchCount = 0
    let fileCount = 0
    await walkFolder({ paths: [root], depth: 1, captureFolderContent: false, batchSize: 8 }, async (batch) => {
        activeDeliveries++
        peakDeliveries = Math.max(peakDeliveries, activeDeliveries)
        batchCount++
        fileCount += batch.filter((entry) => !entry.isFolder).length
        await delay(2)
        activeDeliveries--
    })

    assert.ok(batchCount > 1)
    assert.equal(fileCount, 40)
    assert.equal(peakDeliveries, 1)
})

test("cancellation wakes a blocked batch producer and prevents later batches", async (t) => {
    const root = await makeFixture(1, 40)
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    const controller = new AbortController()
    const firstBatch = deferred()
    let batchCount = 0
    const scanning = walkFolder({ paths: [root], depth: 1, captureFolderContent: false, batchSize: 4, signal: controller.signal }, async () => {
        batchCount++
        if (batchCount === 1) {
            firstBatch.resolve()
            await new Promise(() => undefined)
        }
    })

    await firstBatch.promise
    controller.abort()
    await assert.rejects(scanning, { name: "AbortError" })
    assert.equal(batchCount, 1)
})

test("FolderScanScheduler caps active and queued scans and removes a cancelled queued scan", async () => {
    const scheduler = new FolderScanScheduler(2, 2)
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const started = []
    const active = gates.slice(0, 2).map((gate, index) =>
        scheduler.run(() => {
            started.push(index)
            return gate.promise
        })
    )
    assert.equal(scheduler.activeCount, 2)

    const queuedController = new AbortController()
    const cancelled = scheduler.run(() => {
        started.push(2)
        return gates[2].promise
    }, queuedController.signal)
    const queued = scheduler.run(() => {
        started.push(3)
        return gates[3].promise
    })
    assert.equal(scheduler.queuedCount, 2)
    await assert.rejects(
        scheduler.run(async () => undefined),
        FolderScanQueueFullError
    )

    queuedController.abort()
    await assert.rejects(cancelled, { name: "AbortError" })
    assert.equal(scheduler.queuedCount, 1)
    assert.deepEqual(started, [0, 1])

    gates[0].resolve("first")
    assert.equal(await active[0], "first")
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(started, [0, 1, 3])
    gates[1].resolve("second")
    gates[3].resolve("queued")
    assert.deepEqual(await Promise.all([active[1], queued]), ["second", "queued"])
    assert.equal(scheduler.activeCount, 0)
    assert.equal(scheduler.queuedCount, 0)
})

test("folder scan UI distinguishes complete, partial, cancelled, and failed results", () => {
    assert.deepEqual(getFolderScanViewOutcome({ status: "success", data: { status: "complete", entryCount: 9 } }, 9), { state: "complete", entryCount: 9 })
    assert.deepEqual(getFolderScanViewOutcome({ status: "timeout", execution: "unknown" }, 4), {
        state: "partial",
        entryCount: 4,
        detail: "The folder scan timed out."
    })
    assert.deepEqual(getFolderScanViewOutcome({ status: "timeout", execution: "unknown" }, 0), {
        state: "failed",
        entryCount: 0,
        detail: "The folder scan timed out."
    })
    assert.deepEqual(getFolderScanViewOutcome({ status: "cancelled", work: "may-continue" }, 4), { state: "cancelled", entryCount: 4 })
    assert.deepEqual(getFolderScanViewOutcome({ status: "error", error: { name: "Error", message: "denied" } }, 4), { state: "partial", entryCount: 4, detail: "denied" })
    assert.deepEqual(getFolderScanViewOutcome({ status: "error", error: { name: "Error", message: "denied" } }, 0), { state: "failed", entryCount: 0, detail: "denied" })
})

test("stale or out-of-order batches cannot be applied and ACK identity is exact", () => {
    assert.equal(classifyFolderBatch("current", 2, { requestId: "older", batchSequence: 3 }), "stale")
    assert.equal(classifyFolderBatch("current", 2, { requestId: "current", batchSequence: 3 }), "next")
    assert.equal(classifyFolderBatch("current", 2, { requestId: "current", batchSequence: 2 }), "out-of-order")

    const expected = { requestId: "current", batchSequence: 3, ownerId: 12 }
    assert.equal(matchesFolderBatchAck(expected, { ...expected, accepted: true }), true)
    assert.equal(matchesFolderBatchAck(expected, { ...expected, ownerId: 13, accepted: true }), false)
    assert.equal(matchesFolderBatchAck(expected, { ...expected, batchSequence: 2, accepted: true }), false)
    assert.equal(matchesFolderBatchAck(expected, { ...expected, accepted: false }), false)
})

async function startFakeIndexerWorker() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "media-folder-worker-"))
    await fs.mkdir(path.join(root, "child"))
    for (let index = 0; index < 12; index++) await fs.writeFile(path.join(root, "child", `file-${index}.jpg`), "fixture")

    const originalParentPort = process.parentPort
    const port = {
        listener: null,
        messages: [],
        waiters: [],
        on(event, listener) {
            assert.equal(event, "message")
            this.listener = listener
        },
        postMessage(message) {
            this.messages.push(message)
            for (const waiter of [...this.waiters]) {
                if (waiter.predicate(message)) {
                    this.waiters.splice(this.waiters.indexOf(waiter), 1)
                    clearTimeout(waiter.timeout)
                    waiter.resolve(message)
                }
            }
        },
        send(data) {
            this.listener({ data })
        },
        waitFor(predicate, timeoutMs = 3000) {
            const existing = this.messages.find(predicate)
            if (existing) return Promise.resolve(existing)
            return new Promise((resolve, reject) => {
                const waiter = { predicate, resolve, timeout: setTimeout(() => reject(new Error("Timed out waiting for indexer worker message")), timeoutMs) }
                this.waiters.push(waiter)
            })
        }
    }

    Object.defineProperty(process, "parentPort", { value: port, configurable: true })
    const source = readFileSync(new URL("../../src/electron/indexer/worker.ts", import.meta.url), "utf8")
    const transpiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText
    const module = { exports: {} }
    const localRequire = (id) => {
        if (id === "./DirWalker") return { walkFolder }
        if (id === "./FolderScanScheduler") return { createAbortError: () => Object.assign(new Error("Folder scan cancelled"), { name: "AbortError" }) }
        if (id === "./ShowParser") return { parseShowsFolder: async () => undefined }
        return createRequire(import.meta.url)(id)
    }
    new Function("require", "module", "exports", transpiled)(localRequire, module, module.exports)
    port.send({ type: "INIT", cachePath: "", appDataPath: "" })
    await port.waitFor((message) => message.type === "READY")

    return {
        root,
        port,
        restore() {
            if (originalParentPort === undefined) delete process.parentPort
            else Object.defineProperty(process, "parentPort", { value: originalParentPort, configurable: true })
        }
    }
}

test("worker port emits one batch until its matching sequence ACK", { timeout: 15000 }, async (t) => {
    const worker = await startFakeIndexerWorker()
    t.after(() => {
        worker.restore()
        return fs.rm(worker.root, { recursive: true, force: true })
    })

    const requestId = "one-credit"
    worker.port.send({ type: "READ_FOLDER", requestId, paths: [worker.root], depth: 2, captureFolderContent: false, generateThumbnails: false, batchSize: 4 })
    const first = await worker.port.waitFor((message) => message.type === "READ_FOLDER_BATCH" && message.requestId === requestId)
    await delay(20)
    assert.equal(worker.port.messages.filter((message) => message.type === "READ_FOLDER_BATCH" && message.requestId === requestId).length, 1)

    let sequence = 1
    worker.port.send({ type: "READ_FOLDER_BATCH_ACK", requestId, batchSequence: sequence })
    while (true) {
        const next = await worker.port.waitFor((message) => message.requestId === requestId && ((message.type === "READ_FOLDER_BATCH" && message.batchSequence > sequence) || message.type === "READ_FOLDER_DONE"))
        if (next.type === "READ_FOLDER_DONE") break
        assert.equal(next.batchSequence, sequence + 1)
        sequence = next.batchSequence
        worker.port.send({ type: "READ_FOLDER_BATCH_ACK", requestId, batchSequence: sequence })
    }

    assert.equal(first.batchSequence, 1)
    assert.ok(sequence > 1)
})

test("worker cancellation releases a batch ACK wait and reports cancelled", { timeout: 15000 }, async (t) => {
    const worker = await startFakeIndexerWorker()
    t.after(() => {
        worker.restore()
        return fs.rm(worker.root, { recursive: true, force: true })
    })

    const requestId = "cancel-credit"
    worker.port.send({ type: "READ_FOLDER", requestId, paths: [worker.root], depth: 2, captureFolderContent: false, generateThumbnails: false, batchSize: 4 })
    await worker.port.waitFor((message) => message.type === "READ_FOLDER_BATCH" && message.requestId === requestId)
    worker.port.send({ type: "CANCEL_READ_FOLDER", requestId })
    await worker.port.waitFor((message) => message.type === "READ_FOLDER_CANCELLED" && message.requestId === requestId)
    assert.equal(worker.port.messages.filter((message) => message.type === "READ_FOLDER_BATCH" && message.requestId === requestId).length, 1)
})
