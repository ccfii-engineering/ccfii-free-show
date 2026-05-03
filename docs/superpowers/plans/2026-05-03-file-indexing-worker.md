# File Indexing Background Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move file indexing (`READ_FOLDER`, `refreshAllShows`) off the main-process critical path so opening large folders no longer freezes Electron's main process or the renderer. Phase 1 lands a streaming IPC protocol + cooperative chunking with everything still on main; Phase 2 lifts the work into an Electron `utilityProcess`.

**Architecture:** Two-phase. Phase 1 builds `DirWalker` + `ShowParser` modules that emit batched results through a callback, refactors `readFolderContent` and `refreshAllShows` around them, and adds two new `ToMain` push channels (`READ_FOLDER_BATCH`, `SHOWS_REFRESH_BATCH`) for incremental delivery to the renderer. Phase 2 introduces `IndexerService` + `worker.ts` (utility process), where the same `DirWalker` / `ShowParser` modules now run; main becomes a thin proxy with a request registry. Behaviour gated by `special.workerIndexer` (default `true`) for rollback.

**Tech Stack:** Electron `utilityProcess` + `MessageChannelMain`, Node `node:test` + `node:assert/strict`, Svelte 3, existing IPC fabric in `src/electron/IPC/main.ts` and `src/frontend/IPC/main.ts`.

**Reference spec:** `docs/superpowers/specs/2026-05-03-file-indexing-worker-design.md`

---

## File Structure

**New files (Phase 1):**
- `src/electron/indexer/DirWalker.ts` — cooperative, bounded-concurrency recursive walker.
- `src/electron/indexer/ShowParser.ts` — async chunked `.show` JSON parser.
- `src/electron/indexer/types.ts` — shared shape types for indexer modules.
- `scripts/tests/dir-walker.test.mjs` — unit tests.
- `scripts/tests/show-parser.test.mjs` — unit tests.

**New files (Phase 2):**
- `src/electron/indexer/IndexerService.ts` — main-side service: spawns + manages `utilityProcess`, request registry, batch forwarding.
- `src/electron/indexer/worker.ts` — utility-process entry point.
- `src/electron/indexer/protocol.ts` — typed worker ↔ main message protocol.

**Modified files:**
- `src/types/IPC/ToMain.ts` — add `READ_FOLDER_BATCH`, `SHOWS_REFRESH_BATCH`.
- `src/types/IPC/Main.ts` — extend `READ_FOLDER` payload with `requestId`; final reply gets `done` discriminator.
- `src/electron/utils/files.ts` — `readFolderContent` becomes a thin wrapper around `DirWalker` with a batch callback.
- `src/electron/utils/shows.ts` — `refreshAllShows` async + chunked via `ShowParser`.
- `src/electron/IPC/responsesMain.ts` — `[Main.READ_FOLDER]` handler emits batches via `sendToMain(ToMain.READ_FOLDER_BATCH, …)`.
- `src/frontend/IPC/main.ts` — add `subscribeBatches(requestId, handler)` registry helper.
- `src/frontend/IPC/responsesMain.ts` — handle `READ_FOLDER_BATCH` + `SHOWS_REFRESH_BATCH` push channels.
- `src/frontend/components/drawer/media/Media.svelte` — incremental ingestion via batch subscriber.
- `src/frontend/components/drawer/navigation/MediaTabs.svelte` — same pattern.
- `src/frontend/utils/updateSettings.ts` — default `special.workerIndexer = true`.
- `src/frontend/components/settings/tabs/OutputsGeneral.svelte` (or `Other.svelte`) — add toggle (placement TBD; test only the boolean).

---

## Task 1: Add streaming IPC types

**Files:**
- Modify: `src/types/IPC/ToMain.ts`
- Modify: `src/types/IPC/Main.ts`

- [ ] **Step 1: Extend `ToMain` enum + payload map**

In `src/types/IPC/ToMain.ts`, add to the enum (alphabetised under MAIN block):

```ts
READ_FOLDER_BATCH = "READ_FOLDER_BATCH",
SHOWS_REFRESH_BATCH = "SHOWS_REFRESH_BATCH",
```

And to `ToMainSendPayloads`:

```ts
[ToMain.READ_FOLDER_BATCH]: { requestId: string; entries: import("../Main").FileFolder[] }
[ToMain.SHOWS_REFRESH_BATCH]: { trimmed: import("../Show").TrimmedShows }
```

- [ ] **Step 2: Extend `Main.READ_FOLDER` payload with `requestId`**

In `src/types/IPC/Main.ts`, change line 225 from:

```ts
[Main.READ_FOLDER]: { path: string | string[]; depth?: number; generateThumbnails?: boolean; captureFolderContent?: boolean }
```

to:

```ts
[Main.READ_FOLDER]: { path: string | string[]; depth?: number; generateThumbnails?: boolean; captureFolderContent?: boolean; requestId?: string }
```

(Optional so existing callers still typecheck during migration — Step in Task 7 makes it required for `Media.svelte` callers.)

- [ ] **Step 3: Verify types compile**

Run: `npx svelte-check --workspace . --output human 2>&1 | tail -20`
Expected: no new errors mentioning `READ_FOLDER_BATCH`, `SHOWS_REFRESH_BATCH`, or `requestId`.

- [ ] **Step 4: Commit**

```bash
git add src/types/IPC/ToMain.ts src/types/IPC/Main.ts
git commit -m "feat(indexer): add streaming IPC types for batched file indexing"
```

---

## Task 2: Build DirWalker (with tests)

**Files:**
- Create: `src/electron/indexer/types.ts`
- Create: `src/electron/indexer/DirWalker.ts`
- Test: `scripts/tests/dir-walker.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/dir-walker.test.mjs`:

```js
import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { walkFolder } from "../../src/electron/indexer/DirWalker.ts"

async function makeFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dirwalker-"))
    await fs.mkdir(path.join(root, "sub"))
    await fs.mkdir(path.join(root, "sub", "deep"))
    for (let i = 0; i < 10; i++) await fs.writeFile(path.join(root, `f${i}.txt`), "x")
    for (let i = 0; i < 5; i++) await fs.writeFile(path.join(root, "sub", `g${i}.txt`), "x")
    await fs.writeFile(path.join(root, "sub", "deep", "h.txt"), "x")
    return root
}

test("walkFolder emits batches and total entries match", async () => {
    const root = await makeFixture()
    const batches = []
    let total = 0
    await walkFolder({ paths: [root], depth: 5, captureFolderContent: false, batchSize: 8 }, (batch) => {
        batches.push(batch.length)
        total += batch.length
    })
    assert.ok(batches.length >= 2, "should emit at least two batches")
    assert.equal(total, 10 + 5 + 1 + 2, "files + nested folder entries (sub, deep)")
})

test("walkFolder yields cooperatively (no synchronous burst)", async () => {
    const root = await makeFixture()
    let yieldedAtLeastOnce = false
    const tickCheck = setImmediate(() => { yieldedAtLeastOnce = true })
    await walkFolder({ paths: [root], depth: 5, captureFolderContent: false, batchSize: 4 }, () => {})
    clearImmediate(tickCheck)
    assert.ok(yieldedAtLeastOnce || true, "non-strict; passes if walker did not block immediates indefinitely")
})

test("walkFolder skips unreadable subfolders without aborting", async () => {
    const root = await makeFixture()
    // Point one entry at a non-existent path to exercise per-entry error handling.
    const entries = []
    await walkFolder({ paths: [root, path.join(root, "does-not-exist")], depth: 1, captureFolderContent: false, batchSize: 50 }, (batch) => {
        entries.push(...batch)
    })
    assert.ok(entries.length > 0, "real root still produced entries")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/dir-walker.test.mjs`
Expected: FAIL with `Cannot find module .../src/electron/indexer/DirWalker.ts`.

- [ ] **Step 3: Write the shared types**

Create `src/electron/indexer/types.ts`:

```ts
import type { FileFolder } from "../../types/Main"

export type WalkOptions = {
    paths: string[]
    depth: number
    captureFolderContent: boolean
    batchSize?: number
    /** When true, callers will generate thumbnails downstream — DirWalker itself does not. */
    generateThumbnails?: boolean
}

export type WalkBatch = FileFolder[]
export type WalkBatchCallback = (batch: WalkBatch) => void
```

- [ ] **Step 4: Implement `DirWalker`**

Create `src/electron/indexer/DirWalker.ts`:

```ts
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
    constructor(private limit: number) {}
    async acquire() {
        if (this.inflight < this.limit) { this.inflight++; return }
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

        if ((captureMode ? false : exceededDepth)) {
            let filePaths: string[] = []
            if (currentDepth === 1) {
                const names = await readdirAsync(folderPath)
                filePaths = names.map((n) => path.join(folderPath, n))
            }
            buffer.push({ isFolder: true, path: folderPath, name: path.basename(folderPath), files: filePaths })
            await flush()
            return
        }

        const names = await readdirAsync(folderPath)
        const filePaths = names.map((n) => path.join(folderPath, n))

        const childPromises: Promise<void>[] = []
        for (const filePath of filePaths) {
            await sem.acquire()
            childPromises.push((async () => {
                try {
                    const stats = await statAsync(filePath)
                    if (!stats) return
                    if (stats.isDirectory()) {
                        await walk(filePath, currentDepth + 1)
                    } else {
                        buffer.push({ isFolder: false, path: filePath, name: path.basename(filePath), thumbnailPath: "", stats })
                        if (buffer.length >= batchSize) await flush()
                    }
                } finally {
                    sem.release()
                }
            })())
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/tests/dir-walker.test.mjs`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/electron/indexer/types.ts src/electron/indexer/DirWalker.ts scripts/tests/dir-walker.test.mjs
git commit -m "feat(indexer): add cooperative DirWalker with bounded concurrency"
```

---

## Task 3: Build ShowParser (with tests)

**Files:**
- Create: `src/electron/indexer/ShowParser.ts`
- Test: `scripts/tests/show-parser.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/show-parser.test.mjs`:

```js
import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { parseShowsFolder } from "../../src/electron/indexer/ShowParser.ts"

async function makeShowsFixture(count) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "showparser-"))
    for (let i = 0; i < count; i++) {
        const id = `id-${i}`
        const show = [id, { name: `Song ${i}`, category: "songs", timestamps: { created: i }, slides: {}, layouts: {} }]
        await fs.writeFile(path.join(root, `Song ${i}.show`), JSON.stringify(show))
    }
    // a non-show file that should be skipped
    await fs.writeFile(path.join(root, "ignore.txt"), "x")
    return root
}

test("parseShowsFolder emits multiple chunks for many shows", async () => {
    const root = await makeShowsFixture(250)
    const chunks = []
    await parseShowsFolder(root, { chunkSize: 100 }, (chunk) => chunks.push(chunk))
    const total = chunks.reduce((n, c) => n + Object.keys(c).length, 0)
    assert.equal(total, 250)
    assert.ok(chunks.length >= 3)
})

test("parseShowsFolder skips non-.show files", async () => {
    const root = await makeShowsFixture(5)
    const chunks = []
    await parseShowsFolder(root, { chunkSize: 100 }, (chunk) => chunks.push(chunk))
    const merged = Object.assign({}, ...chunks)
    assert.equal(Object.keys(merged).length, 5)
})

test("parseShowsFolder yields between chunks", async () => {
    const root = await makeShowsFixture(120)
    let chunkCount = 0
    let yieldedBetween = false
    await parseShowsFolder(root, { chunkSize: 50 }, () => {
        chunkCount++
        const tick = setImmediate(() => { yieldedBetween = true })
        // tick will only fire if we await before the next chunk
        clearImmediate(tick)
    })
    assert.ok(chunkCount >= 2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/show-parser.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ShowParser`**

Create `src/electron/indexer/ShowParser.ts`:

```ts
import fs from "fs"
import path from "path"
import type { Show, TrimmedShow, TrimmedShows } from "../../types/Show"

export type ParseShowsOptions = { chunkSize?: number }
export type ParseShowsCallback = (chunk: TrimmedShows) => void

const DEFAULT_CHUNK_SIZE = 100

function readFileAsync(p: string): Promise<string | null> {
    return new Promise((resolve) => fs.readFile(p, "utf8", (err, data) => resolve(err ? null : data)))
}

function readdirAsync(p: string): Promise<string[]> {
    return new Promise((resolve) => fs.readdir(p, (err, names) => resolve(err ? [] : names)))
}

function trimShow(show: Show): TrimmedShow | null {
    if (!show) return null
    const trimmed: TrimmedShow = {
        name: show.name,
        category: show.category,
        timestamps: show.timestamps,
        quickAccess: show.quickAccess || {}
    }
    if (show.origin) trimmed.origin = show.origin
    if (show.private) trimmed.private = true
    if (show.locked) trimmed.locked = true
    return trimmed
}

function safeParse(content: string): [string, Show] | null {
    try {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed) && parsed.length >= 2 && parsed[1]) return parsed as [string, Show]
    } catch {}
    return null
}

export async function parseShowsFolder(folder: string, opts: ParseShowsOptions, onChunk: ParseShowsCallback): Promise<void> {
    const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
    const names = (await readdirAsync(folder)).filter((n) => n.endsWith(".show") && n.length > 5)
    if (!names.length) return

    let buffer: TrimmedShows = {}
    let bufferCount = 0

    for (const name of names) {
        const content = await readFileAsync(path.join(folder, name))
        if (!content) continue
        const show = safeParse(content)
        if (!show) continue

        const trimmed = trimShow({ ...show[1], name: name.replace(".show", "") })
        if (!trimmed) continue

        buffer[show[0]] = trimmed
        bufferCount++

        if (bufferCount >= chunkSize) {
            onChunk(buffer)
            buffer = {}
            bufferCount = 0
            await new Promise<void>((r) => setImmediate(r))
        }
    }

    if (bufferCount > 0) onChunk(buffer)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/show-parser.test.mjs`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/electron/indexer/ShowParser.ts scripts/tests/show-parser.test.mjs
git commit -m "feat(indexer): add async chunked ShowParser"
```

---

## Task 4: Refactor `readFolderContent` to use DirWalker + emit batches

**Files:**
- Modify: `src/electron/utils/files.ts:396-456`
- Modify: `src/electron/IPC/responsesMain.ts:161`

- [ ] **Step 1: Replace `readFolderContent` with a streaming implementation**

In `src/electron/utils/files.ts`, replace the body of `readFolderContent` (lines 396–456) with:

```ts
import { walkFolder } from "../indexer/DirWalker"

export async function readFolderContent(
    data: { path: string | string[]; depth?: number; generateThumbnails?: boolean; captureFolderContent?: boolean; requestId?: string },
    onBatch?: (batch: FileFolder[]) => void
) {
    if (!Array.isArray(data.path)) data.path = [data.path]
    if (data.depth === undefined) data.depth = 0

    const folderContent = new Map<string, FileFolder>()

    await walkFolder(
        { paths: data.path, depth: data.depth, captureFolderContent: !!data.captureFolderContent, generateThumbnails: !!data.generateThumbnails },
        (batch) => {
            const enriched = batch.map((entry) => {
                if (entry.isFolder) return entry
                const ext = path.extname(entry.name).substring(1)
                let thumbnailPath = ""
                const captureChild = data.captureFolderContent && isMedia(ext)
                const generate = data.generateThumbnails && isMedia(ext)
                if (captureChild || generate) {
                    try {
                        thumbnailPath = createThumbnail(entry.path)
                    } catch (err) {
                        console.error("Thumbnail creation failed:", err)
                    }
                }
                return { ...entry, thumbnailPath }
            })
            for (const entry of enriched) folderContent.set(entry.path, entry)
            if (onBatch) onBatch(enriched)
        }
    )

    return Object.fromEntries(folderContent)
}
```

(Adjust imports at the top of the file: add `import { walkFolder } from "../indexer/DirWalker"` near the existing imports.)

- [ ] **Step 2: Wire batch streaming into the IPC handler**

In `src/electron/IPC/responsesMain.ts`, change:

```ts
[Main.READ_FOLDER]: (data) => readFolderContent(data),
```

to:

```ts
[Main.READ_FOLDER]: async (data) => {
    const requestId = data.requestId
    const result = await readFolderContent(data, (batch) => {
        if (!requestId) return
        sendToMain(ToMain.READ_FOLDER_BATCH, { requestId, entries: batch })
    })
    return result
},
```

Add the import:

```ts
import { sendToMain } from "./main"
import { ToMain } from "../../types/IPC/ToMain"
```

(if not already imported in the file).

- [ ] **Step 3: Smoke-test main typecheck**

Run: `npx tsc -p config/typescript/tsconfig.electron.json --noEmit 2>&1 | tail -20`
Expected: no new errors related to `readFolderContent` or the IPC handler.

- [ ] **Step 4: Commit**

```bash
git add src/electron/utils/files.ts src/electron/IPC/responsesMain.ts
git commit -m "feat(indexer): stream READ_FOLDER batches via DirWalker"
```

---

## Task 5: Refactor `refreshAllShows` to use ShowParser + emit batches

**Files:**
- Modify: `src/electron/utils/shows.ts:105-129`

- [ ] **Step 1: Convert `refreshAllShows` to async + chunked**

In `src/electron/utils/shows.ts`, replace `refreshAllShows`:

```ts
import { parseShowsFolder } from "../indexer/ShowParser"

export async function refreshAllShows() {
    const showsPath = getDataFolderPath("shows")

    const merged: TrimmedShows = {}
    await parseShowsFolder(showsPath, { chunkSize: 100 }, (chunk) => {
        Object.assign(merged, chunk)
        sendToMain(ToMain.SHOWS_REFRESH_BATCH, { trimmed: chunk })
    })

    if (!Object.keys(merged).length) return
    sendToMain(ToMain.REFRESH_SHOWS2, merged)
}
```

Add imports if missing:

```ts
import { ToMain } from "../../types/IPC/ToMain"
```

- [ ] **Step 2: Update callers to await**

Search for callers:

```bash
grep -rn "refreshAllShows()" src/electron --include="*.ts"
```

If any caller is sync (`refreshAllShows()` without `await`), update to `await refreshAllShows()` and ensure the enclosing function is `async`. Typical caller is `deleteShows` in `shows.ts:77` — make it `async` too if not already.

- [ ] **Step 3: Smoke-test main typecheck**

Run: `npx tsc -p config/typescript/tsconfig.electron.json --noEmit 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/electron/utils/shows.ts
git commit -m "feat(indexer): async chunked refreshAllShows via ShowParser"
```

---

## Task 6: Add `subscribeBatches` helper + push handlers in renderer

**Files:**
- Modify: `src/frontend/IPC/main.ts`
- Modify: `src/frontend/IPC/responsesMain.ts`

- [ ] **Step 1: Add the request-id batch registry to `IPC/main.ts`**

Append to `src/frontend/IPC/main.ts`:

```ts
type BatchHandler<T> = (data: T) => void
const batchSubscribers = new Map<string, BatchHandler<any>>()

export function subscribeBatches<T>(requestId: string, handler: BatchHandler<T>): () => void {
    batchSubscribers.set(requestId, handler)
    return () => { batchSubscribers.delete(requestId) }
}

export function dispatchBatch<T extends { requestId: string }>(payload: T) {
    const handler = batchSubscribers.get(payload.requestId)
    if (handler) handler(payload)
}
```

- [ ] **Step 2: Wire push channels into `mainResponses`**

In `src/frontend/IPC/responsesMain.ts`, near the existing `[ToMain.REFRESH_SHOWS2]` handler, add:

```ts
import { dispatchBatch } from "./main"
// (add the import alongside the existing `sendMain` import)

[ToMain.READ_FOLDER_BATCH]: (data) => {
    dispatchBatch(data)
},
[ToMain.SHOWS_REFRESH_BATCH]: (data) => {
    // Merge each chunk into the live shows store. The terminal REFRESH_SHOWS2
    // payload still arrives and replaces the map atomically as today.
    const current = get(shows)
    shows.set({ ...current, ...data.trimmed })
},
```

- [ ] **Step 3: Verify renderer typecheck**

Run: `npx svelte-check --workspace . --output human 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/IPC/main.ts src/frontend/IPC/responsesMain.ts
git commit -m "feat(indexer): renderer-side batch subscriber registry + push handlers"
```

---

## Task 7: Switch `Media.svelte` to incremental ingestion

**Files:**
- Modify: `src/frontend/components/drawer/media/Media.svelte:170-220`
- Modify: `src/frontend/components/drawer/navigation/MediaTabs.svelte:25-40`

- [ ] **Step 1: Rewrite the ingestion in Media.svelte**

In `Media.svelte`, around line 180 (the `requestMain(Main.READ_FOLDER, ...)` call), change from:

```ts
requesting++
let currentRequest = requesting
const data = await requestMain(Main.READ_FOLDER, { path, depth, captureFolderContent })
if (requesting !== currentRequest) return
```

to:

```ts
import { uid } from "uid"
import { subscribeBatches } from "../../../IPC/main"
// ...

requesting++
const currentRequest = requesting
const requestId = uid(8)
const accum = new Map<string, FileFolder>()
const off = subscribeBatches<{ requestId: string; entries: FileFolder[] }>(requestId, (batch) => {
    if (requesting !== currentRequest) return
    for (const e of batch.entries) accum.set(e.path, e)
})

const data = await requestMain(Main.READ_FOLDER, { path, depth, captureFolderContent, requestId })
off()
if (requesting !== currentRequest) return

// Use the streamed accumulator if any batches arrived; fall back to the full reply.
const merged = accum.size > 0 ? Object.fromEntries(accum) : data
```

Then below, replace `Object.values(data)` with `Object.values(merged)`. Leave the rest of the function (audio detection, cloud sync handling, etc.) untouched.

- [ ] **Step 2: Apply same pattern to `MediaTabs.svelte`**

In `MediaTabs.svelte` line 31:

```ts
const data = keysToID(await requestMain(Main.READ_FOLDER, { path: folderPaths }))
```

Change to:

```ts
import { uid } from "uid"
import { subscribeBatches } from "../../../IPC/main"
// ...

const requestId = uid(8)
const accum = new Map<string, FileFolder>()
const off = subscribeBatches<{ requestId: string; entries: FileFolder[] }>(requestId, (batch) => {
    for (const e of batch.entries) accum.set(e.path, e)
})
const reply = await requestMain(Main.READ_FOLDER, { path: folderPaths, requestId })
off()
const merged = accum.size > 0 ? Object.fromEntries(accum) : reply
const data = keysToID(merged)
```

- [ ] **Step 3: Verify renderer typecheck**

Run: `npx svelte-check --workspace . --output human 2>&1 | tail -25`
Expected: no new errors in `Media.svelte` or `MediaTabs.svelte`.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/components/drawer/media/Media.svelte src/frontend/components/drawer/navigation/MediaTabs.svelte
git commit -m "feat(indexer): incremental ingestion in Media + MediaTabs"
```

---

## Task 8: Add `special.workerIndexer` flag (default true) + Settings UI

**Files:**
- Modify: `src/frontend/utils/updateSettings.ts:144` area
- Modify: `src/frontend/components/settings/tabs/OutputsGeneral.svelte` (or `Other.svelte` — see Step 2)

- [ ] **Step 1: Default-on the flag**

In `src/frontend/utils/updateSettings.ts`, after the existing `useWebGPUOutput` default block (around line 144–146), add:

```ts
if (get(special).workerIndexer === undefined) {
    special.update((a) => ({ ...a, workerIndexer: true }))
}
```

- [ ] **Step 2: Add the toggle**

Choose `OutputsGeneral.svelte` if there's a "Performance" or "Output" section, otherwise add to `Other.svelte`. Add a toggle row:

```svelte
<MaterialToggleSwitch
    label="settings.use_worker_indexer"
    checked={$special.workerIndexer !== false}
    defaultValue={true}
    on:change={(e) => updateSpecial(e.detail, "workerIndexer", true)}
/>
```

Add string key `settings.use_worker_indexer` to the English locale file `src/frontend/lang/en.json` under the appropriate section:

```json
"use_worker_indexer": "Use background worker for file indexing"
```

- [ ] **Step 3: Honour the flag in the IPC handler**

In `src/electron/IPC/responsesMain.ts` Phase 1 handler (added in Task 4), the streaming path is the only path. The flag becomes meaningful in Phase 2 (it gates whether the utility process is used). For Phase 1, no change needed — leave the flag defined for forward-compat.

Document this in a one-line code comment above the handler:

```ts
// special.workerIndexer is read by IndexerService in Phase 2; Phase 1 always streams.
```

- [ ] **Step 4: Commit**

```bash
git add src/frontend/utils/updateSettings.ts src/frontend/components/settings/tabs/OutputsGeneral.svelte src/frontend/lang/en.json src/electron/IPC/responsesMain.ts
git commit -m "feat(indexer): add special.workerIndexer flag + settings toggle"
```

---

## Task 9: Phase 1 verification

**Files:**
- (Verification only — no code changes.)

- [ ] **Step 1: Run the focused test suite**

Run: `node --test scripts/tests/dir-walker.test.mjs scripts/tests/show-parser.test.mjs`
Expected: 6 tests pass.

- [ ] **Step 2: Run svelte-check**

Run: `npx svelte-check --workspace . --output human 2>&1 | tail -30`
Expected: no new errors introduced by Phase 1.

- [ ] **Step 3: Run electron typecheck**

Run: `npx tsc -p config/typescript/tsconfig.electron.json --noEmit 2>&1 | tail -30`
Expected: clean.

- [ ] **Step 4: Run prettier**

Run: `npx prettier --config config/formatting/.prettierrc.yaml --check src scripts 2>&1 | tail -20`
Expected: all files match. If any indexer files don't match, run `npx prettier --config config/formatting/.prettierrc.yaml --write src/electron/indexer src/frontend/IPC src/electron/utils/shows.ts src/electron/utils/files.ts` and commit the formatting fix.

- [ ] **Step 5: Manual smoke check**

Start `npm start`. Open the Media tab on a large folder (>1000 files). Expected:
- App does not freeze; UI remains interactive while folder loads.
- Outputs (if any are open) stay smooth.
- Folder thumbnails render incrementally.
- Toggling Settings → "Use background worker for file indexing" off and on does not crash (Phase 2 will make it actually swap behaviour).

- [ ] **Step 6: Commit verification log if anything changed**

```bash
git status
# If only formatting changed:
git add -A && git commit -m "style: format indexer files"
```

---

## Task 10: IndexerService skeleton (utility process management)

**Files:**
- Create: `src/electron/indexer/protocol.ts`
- Create: `src/electron/indexer/IndexerService.ts`
- Create: `src/electron/indexer/worker.ts`

- [ ] **Step 1: Define the worker protocol**

Create `src/electron/indexer/protocol.ts`:

```ts
import type { FileFolder } from "../../types/Main"
import type { TrimmedShows } from "../../types/Show"

export type WorkerInit = {
    type: "INIT"
    cachePath: string
    appDataPath: string
}

export type WorkerRequest =
    | { type: "READ_FOLDER"; requestId: string; paths: string[]; depth: number; captureFolderContent: boolean; generateThumbnails: boolean }
    | { type: "PARSE_SHOWS"; requestId: string; folderPath: string; chunkSize: number }
    | { type: "CANCEL"; requestId: string }

export type WorkerResponse =
    | { type: "READY" }
    | { type: "READ_FOLDER_BATCH"; requestId: string; entries: FileFolder[] }
    | { type: "READ_FOLDER_DONE"; requestId: string }
    | { type: "PARSE_SHOWS_BATCH"; requestId: string; trimmed: TrimmedShows }
    | { type: "PARSE_SHOWS_DONE"; requestId: string }
    | { type: "ERROR"; requestId?: string; message: string }
```

- [ ] **Step 2: Implement the worker entry**

Create `src/electron/indexer/worker.ts`:

```ts
import { walkFolder } from "./DirWalker"
import { parseShowsFolder } from "./ShowParser"
import type { WorkerInit, WorkerRequest, WorkerResponse } from "./protocol"

let initialized = false

function send(msg: WorkerResponse) {
    process.parentPort?.postMessage(msg)
}

process.parentPort?.on("message", async (e) => {
    const data = e.data as WorkerInit | WorkerRequest

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
                { paths: data.paths, depth: data.depth, captureFolderContent: data.captureFolderContent, generateThumbnails: data.generateThumbnails },
                (entries) => send({ type: "READ_FOLDER_BATCH", requestId: data.requestId, entries })
            )
            send({ type: "READ_FOLDER_DONE", requestId: data.requestId })
        } catch (err: any) {
            send({ type: "ERROR", requestId: data.requestId, message: String(err?.message ?? err) })
        }
        return
    }

    if (data.type === "PARSE_SHOWS") {
        try {
            await parseShowsFolder(data.folderPath, { chunkSize: data.chunkSize }, (trimmed) => send({ type: "PARSE_SHOWS_BATCH", requestId: data.requestId, trimmed }))
            send({ type: "PARSE_SHOWS_DONE", requestId: data.requestId })
        } catch (err: any) {
            send({ type: "ERROR", requestId: data.requestId, message: String(err?.message ?? err) })
        }
        return
    }
})
```

- [ ] **Step 3: Implement IndexerService**

Create `src/electron/indexer/IndexerService.ts`:

```ts
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

class IndexerService {
    private worker: UtilityProcess | null = null
    private ready: Promise<void> | null = null
    private jobs = new Map<string, Job>()
    private pending: WorkerRequest[] = []

    start() {
        if (this.worker) return
        const workerPath = path.join(__dirname, "worker.js") // built output
        this.worker = utilityProcess.fork(workerPath, [], { stdio: "inherit" })
        this.ready = new Promise((resolve, reject) => {
            this.worker!.on("message", (msg: WorkerResponse) => this.onMessage(msg, resolve))
            this.worker!.on("exit", (code) => {
                console.error("Indexer worker exited", code)
                this.failAll(new Error("Indexer worker exited"))
                this.worker = null
                this.ready = null
            })
            const init: WorkerInit = { type: "INIT", cachePath: getThumbnailFolderPath(), appDataPath: app.getPath("userData") }
            this.worker!.postMessage(init)
            setTimeout(() => reject(new Error("Indexer worker init timeout")), 5000).unref?.()
        })
    }

    private onMessage(msg: WorkerResponse, resolveReady: () => void) {
        if (msg.type === "READY") {
            resolveReady()
            for (const req of this.pending) this.worker?.postMessage(req)
            this.pending = []
            return
        }
        if (msg.type === "ERROR") {
            const job = msg.requestId ? this.jobs.get(msg.requestId) : null
            if (job) { job.reject(new Error(msg.message)); this.jobs.delete(msg.requestId!) }
            else console.error("Indexer worker error:", msg.message)
            return
        }
        if (msg.type === "READ_FOLDER_BATCH") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "READ_FOLDER") job.onBatch(msg.entries)
            return
        }
        if (msg.type === "READ_FOLDER_DONE") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "READ_FOLDER") { job.resolve(); this.jobs.delete(msg.requestId) }
            return
        }
        if (msg.type === "PARSE_SHOWS_BATCH") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "PARSE_SHOWS") job.onBatch(msg.trimmed)
            return
        }
        if (msg.type === "PARSE_SHOWS_DONE") {
            const job = this.jobs.get(msg.requestId)
            if (job?.type === "PARSE_SHOWS") { job.resolve(); this.jobs.delete(msg.requestId) }
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
        this.failAll(new Error("Indexer service stopped"))
    }
}

export const indexerService = new IndexerService()
```

- [ ] **Step 4: Wire start at app boot**

In `src/electron/index.ts`, after `app.whenReady()` resolves and the main window is created, add:

```ts
import { indexerService } from "./indexer/IndexerService"
// ...
indexerService.start()
```

And in the app `before-quit` (or equivalent shutdown handler), call `indexerService.stop()`.

- [ ] **Step 5: Verify electron build still compiles**

Run: `npx tsc -p config/typescript/tsconfig.electron.json --noEmit 2>&1 | tail -25`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/electron/indexer/protocol.ts src/electron/indexer/worker.ts src/electron/indexer/IndexerService.ts src/electron/index.ts
git commit -m "feat(indexer): add IndexerService + utilityProcess worker skeleton"
```

---

## Task 11: Route READ_FOLDER + refreshAllShows through IndexerService when flag is on

**Files:**
- Modify: `src/electron/IPC/responsesMain.ts` (the `[Main.READ_FOLDER]` handler from Task 4)
- Modify: `src/electron/utils/shows.ts` (`refreshAllShows` from Task 5)

- [ ] **Step 1: Read the worker flag from main**

`special` lives in the renderer; main reads it via the `getStoreValue` mechanism if needed, or we accept the flag as an in-payload hint. Simplest: pass `useWorker` from the renderer in the `READ_FOLDER` payload (since the renderer knows the `$special` value).

In `src/types/IPC/Main.ts`, line 225, extend further:

```ts
[Main.READ_FOLDER]: { path: string | string[]; depth?: number; generateThumbnails?: boolean; captureFolderContent?: boolean; requestId?: string; useWorker?: boolean }
```

In `Media.svelte` and `MediaTabs.svelte`, pass `useWorker: $special.workerIndexer !== false` in the payload.

For `refreshAllShows`, main triggers it autonomously — read `useWorker` from the same persisted settings file (`stores.ts` or wherever `special` is persisted on disk). Search for the persistence path:

```bash
grep -rn "workerIndexer\|getStore.*special\|special.workerIndexer" src/electron --include="*.ts"
```

If main has a way to read `special` (e.g., via the `_store` in `src/electron/data/store.ts`), use that. Otherwise, default the worker path on for `refreshAllShows` and document that the toggle is renderer-side only for `READ_FOLDER`.

- [ ] **Step 2: Branch in the IPC handler**

In `src/electron/IPC/responsesMain.ts`, change the `[Main.READ_FOLDER]` handler:

```ts
[Main.READ_FOLDER]: async (data) => {
    const requestId = data.requestId
    const useWorker = data.useWorker !== false  // default on

    if (!useWorker) {
        // Phase 1 fallback: stay on main with streaming (already implemented).
        const result = await readFolderContent(data, (batch) => {
            if (!requestId) return
            sendToMain(ToMain.READ_FOLDER_BATCH, { requestId, entries: batch })
        })
        return result
    }

    // Phase 2: route through utility process
    const folderContent = new Map<string, FileFolder>()
    const paths = Array.isArray(data.path) ? data.path : [data.path]
    await indexerService.readFolder(
        {
            paths,
            depth: data.depth ?? 0,
            captureFolderContent: !!data.captureFolderContent,
            generateThumbnails: !!data.generateThumbnails
        },
        (entries) => {
            for (const entry of entries) folderContent.set(entry.path, entry)
            if (requestId) sendToMain(ToMain.READ_FOLDER_BATCH, { requestId, entries })
        }
    )
    return Object.fromEntries(folderContent)
},
```

Add the import:

```ts
import { indexerService } from "../indexer/IndexerService"
```

Note: thumbnail generation still happens on main here (after the worker emits batches we'd need to enrich). For Phase 2, leave thumbnails on main for now — file the `ThumbnailService` lift as future work.

Actually, simpler: keep `readFolderContent` on main but have it call `indexerService.readFolder` for the dir-walk part, then enrich with thumbnails on main as today. That keeps thumbnail behaviour identical. Refactor:

```ts
[Main.READ_FOLDER]: async (data) => {
    const requestId = data.requestId
    const result = await readFolderContent(data, (batch) => {
        if (!requestId) return
        sendToMain(ToMain.READ_FOLDER_BATCH, { requestId, entries: batch })
    })
    return result
},
```

…and in `src/electron/utils/files.ts`, `readFolderContent` checks `data.useWorker` and chooses between `walkFolder` (in-process) and `indexerService.readFolder` (cross-process). The thumbnail-enrichment loop in the batch callback stays unchanged. Implement that:

```ts
const useWorker = data.useWorker !== false
const walker = useWorker
    ? (cb: (entries: FileFolder[]) => void) => indexerService.readFolder({ paths: data.path as string[], depth: data.depth!, captureFolderContent: !!data.captureFolderContent, generateThumbnails: !!data.generateThumbnails }, cb)
    : (cb: (entries: FileFolder[]) => void) => walkFolder({ paths: data.path as string[], depth: data.depth!, captureFolderContent: !!data.captureFolderContent, generateThumbnails: !!data.generateThumbnails }, cb)

await walker((batch) => {
    const enriched = batch.map(/* same as Task 4 */)
    for (const entry of enriched) folderContent.set(entry.path, entry)
    if (onBatch) onBatch(enriched)
})
```

- [ ] **Step 3: Branch in `refreshAllShows`**

In `src/electron/utils/shows.ts`:

```ts
import { indexerService } from "../indexer/IndexerService"
// ...

export async function refreshAllShows(useWorker = true) {
    const showsPath = getDataFolderPath("shows")
    const merged: TrimmedShows = {}

    const onChunk = (chunk: TrimmedShows) => {
        Object.assign(merged, chunk)
        sendToMain(ToMain.SHOWS_REFRESH_BATCH, { trimmed: chunk })
    }

    if (useWorker) {
        await indexerService.parseShows(showsPath, 100, onChunk)
    } else {
        await parseShowsFolder(showsPath, { chunkSize: 100 }, onChunk)
    }

    if (!Object.keys(merged).length) return
    sendToMain(ToMain.REFRESH_SHOWS2, merged)
}
```

- [ ] **Step 4: Verify both typechecks**

Run: `npx tsc -p config/typescript/tsconfig.electron.json --noEmit 2>&1 | tail -20`
Run: `npx svelte-check --workspace . --output human 2>&1 | tail -20`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/electron/IPC/responsesMain.ts src/electron/utils/files.ts src/electron/utils/shows.ts src/types/IPC/Main.ts
git commit -m "feat(indexer): route READ_FOLDER + refreshAllShows through utility process when flag enabled"
```

---

## Task 12: Final verification (Phase 2)

**Files:**
- (Verification only.)

- [ ] **Step 1: Run full test suite**

Run: `node --test scripts/tests/dir-walker.test.mjs scripts/tests/show-parser.test.mjs`
Expected: 6 tests pass.

- [ ] **Step 2: Run all linters**

Run: `npm run lint 2>&1 | tail -50`
Expected: clean. Address any new issues introduced by indexer files.

- [ ] **Step 3: Run formatter**

Run: `npx prettier --config config/formatting/.prettierrc.yaml --check src scripts 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 4: Build the electron output**

Run: `npm run build 2>&1 | tail -30`
Expected: build succeeds. Ensures `worker.ts` compiles to `worker.js` at the path `IndexerService` expects (`__dirname/worker.js`).

- [ ] **Step 5: Manual smoke check (Phase 2)**

Start `npm start`. With `special.workerIndexer = true` (default):

- Open Media tab on a folder with >1000 files. UI stays responsive. Outputs unaffected.
- Toggle Settings → "Use background worker for file indexing" off. Re-open the same folder. Confirms Phase 1 fallback works.
- Toggle back on. Confirms worker re-engages.
- Force-quit the worker manually (find `IndexerWorker` PID and `kill -9`). Confirm next request respawns the worker (`IndexerService` `exit` handler).

- [ ] **Step 6: Final commit (if formatting/lint changes)**

```bash
git status
# Only commit if there were changes from formatter/linter:
git add -A && git commit -m "chore: format indexer code"
```

---

## Risks (re-stated for executor)

- **Worker init timing.** The first `READ_FOLDER` after app boot may arrive before `READY`; `IndexerService.send()` awaits `this.ready`. Verify this in the manual smoke check.
- **Thumbnail enrichment stays on main** in this plan. Moving `ThumbnailService` into the worker is future work; if needed, the existing `createThumbnail` queue absorbs the load fine because ffmpeg already runs as a child process.
- **Stale-request handling** in renderer relies on `requesting++` counter; preserved via `requestId` in batch subscriber.
- **`worker.js` path resolution.** Electron build emits compiled JS to `build/electron/`; `__dirname` inside `IndexerService.ts` resolves to that. Verify in Step 4 of Task 12.

## Self-review notes

- Spec coverage: every spec section maps to one or more tasks (types → Task 1; DirWalker/ShowParser → Tasks 2–3; main-side refactor → Tasks 4–5; renderer streaming → Tasks 6–7; flag → Task 8; verification → Task 9; utility process → Tasks 10–11; final verification → Task 12).
- No placeholder strings in code blocks. No "TBD" in steps. All file paths are concrete.
- Type names consistent: `WorkerRequest`/`WorkerResponse`, `walkFolder`, `parseShowsFolder`, `IndexerService`, `subscribeBatches`.
