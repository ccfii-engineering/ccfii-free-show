# File Indexing Background Worker — Design

**Date:** 2026-05-03
**Status:** Draft (approved by user, no review requested)
**Owner:** Performance / Electron

## Problem

Opening the Media tab on a folder with thousands of files freezes both the
Electron main process and the renderer for several seconds. The Shows tab
exhibits the same symptom on startup with large libraries. Outputs and IPC
become unresponsive during the freeze.

Three compounding causes:

1. **Sync work on main.** `refreshAllShows()` in `src/electron/utils/shows.ts`
   is fully synchronous (`readFolder` + `readFile` + `parseShow` per file).
   `readFolderContent()` in `src/electron/utils/files.ts` recurses with an
   unbounded `Promise.all` of `fs.stat` calls, saturating the libuv thread
   pool and event loop.
2. **Inline thumbnail queueing on main.** `createThumbnail` is invoked from
   the dir walker, which adds entries to a queue that runs ffmpeg as
   `child_process` from main. Many simultaneous spawns stutter main.
3. **One giant IPC reply.** `Object.fromEntries(folderContent)` is serialized
   whole, deserialized in the renderer, then dumped into Svelte stores —
   triggering a reactive storm against `$media`/`$shows`.

A worker alone fixes #1 and #2 but not #3. The design addresses all three.

## Goals

- Main process stays responsive during indexing — IPC, outputs, capture all
  remain smooth.
- Renderer does not stall when results arrive — incremental ingestion, no
  reactive storm.
- No user-visible regression in indexing semantics: same fields, same
  filtering, same thumbnail behavior.
- Reversible: a feature flag (`special.workerIndexer`) allows falling back to
  the current synchronous path. Default ON.

## Non-Goals

- Watching folders for live changes (`fs.watch`) — out of scope.
- Persistent on-disk index/database — out of scope.
- Cancelling in-flight ffmpeg jobs on folder change — best-effort: jobs that
  already started run to completion; only queued jobs are dropped.
- Refactoring renderer-side `$media` store shape — incremental ingestion
  merges into the existing keyed map.

## Architecture

```
renderer ── Main.READ_FOLDER ─────▶ main ── MessagePort ──▶ indexer (utilityProcess)
                                       ◀──── batch chunks ──── (DirWalker, ShowParser,
renderer ◀── ToMain.READ_FOLDER_BATCH (chunks)                  ThumbnailService)
renderer ◀── Main.READ_FOLDER reply { done: true, requestId }
```

### Components

**`src/electron/indexer/IndexerService.ts`** (main side)
- Spawns the utility process at app boot via `utilityProcess.fork()`.
- Owns the `MessageChannelMain` to the worker.
- Maintains a request registry keyed by `requestId` for in-flight jobs.
- Forwards `READ_FOLDER`, `LOAD_SHOWS_FOR_REFRESH`, `GET_THUMBNAIL` to worker.
- Receives batch messages and forwards to renderer on `ToMain.READ_FOLDER_BATCH`
  and `ToMain.SHOWS_REFRESH_BATCH`.
- Handles worker crash: respawns automatically, fails in-flight requests.

**`src/electron/indexer/worker.ts`** (utility process entry)
- Loads cache paths passed in via init message.
- Hosts `DirWalker`, `ShowParser`, `ThumbnailService`.

**`src/electron/indexer/DirWalker.ts`**
- Bounded-concurrency recursive walker (semaphore = 16 stat in flight).
- Yields entries in batches of 200 OR per subfolder boundary, whichever first.
- Cooperative `await setImmediate()` between batches.

**`src/electron/indexer/ShowParser.ts`**
- Reads + parses `.show` JSON in chunks (e.g., 100 per chunk), yielding
  between chunks.
- Returns `TrimmedShow` objects.

**`src/electron/indexer/ThumbnailService.ts`**
- Owns the ffmpeg queue (lifted from `src/electron/data/thumbnails.ts`).
- Caches "thumbnail file exists" set in memory; invalidates on miss.
- Sends `THUMBNAIL_READY` events back to main, which forwards to renderer.

### Phase split

- **Phase 1** (immediate relief): all logic stays on main, but the streaming
  protocol + cooperative chunking land. `readFolderContent` becomes async-
  generator-shaped, `refreshAllShows` becomes async + chunked. Renderer
  switches to incremental ingestion. ffmpeg queue stays as-is on main.
- **Phase 2** (full isolation): introduce `IndexerService` + `utilityProcess`
  worker. Main becomes a thin proxy. Streaming protocol is unchanged from
  Phase 1 — only the *source* of batches moves.

## Data Flow

### `READ_FOLDER` (Media tab)

1. Renderer calls `requestMain(Main.READ_FOLDER, { path, depth, captureFolderContent })`.
   `requestMain` registers a listener under `requestId` (already keyed in
   the existing IPC fabric).
2. Main routes the request:
   - **Phase 1**: directly to `readFolderContent`, which now emits batches
     via a callback that sends `ToMain.READ_FOLDER_BATCH { requestId, entries }`
     for each batch.
   - **Phase 2**: to `IndexerService.readFolder(requestId, ...)` which
     forwards to the worker; batches come back via MessagePort, get
     forwarded to renderer over `ToMain.READ_FOLDER_BATCH`.
3. When complete, main resolves the original `READ_FOLDER` request with
   `{ done: true, requestId }`. Renderer's `await requestMain(...)` resolves.
4. While the request is in flight, the renderer subscribes to
   `ToMain.READ_FOLDER_BATCH` filtering by `requestId`, merging entries
   into a local map. On `done`, the renderer reads the local map and
   updates UI state.

### Shows refresh

1. Main triggers `refreshAllShows()` (already kicked from initialization).
2. Worker (Phase 2) walks the shows folder, parses `.show` JSON in chunks,
   and emits `ToMain.SHOWS_REFRESH_BATCH { trimmedShows }` per chunk.
3. Renderer accumulates into a local `TrimmedShows` map, and on
   `ToMain.REFRESH_SHOWS2` (terminal) does the final `shows.set()`.
   Important: `shows.set()` is still a single write — what we've avoided is
   the synchronous parse blocking main.

### Thumbnails

- Phase 1: existing flow unchanged.
- Phase 2: `THUMBNAIL_READY` flows worker → main → renderer over the
  existing `Main.GET_THUMBNAIL` reply mechanism (no protocol change for
  the renderer beyond a one-shot vs streaming distinction, which is
  already async).

## Streaming Protocol (renderer-facing)

New IPC message types (`src/types/IPC/ToMain.ts`):

```ts
READ_FOLDER_BATCH = "READ_FOLDER_BATCH",
SHOWS_REFRESH_BATCH = "SHOWS_REFRESH_BATCH",
```

Payloads:

```ts
[ToMain.READ_FOLDER_BATCH]: {
  requestId: string
  entries: FileFolder[]   // partial slice of the final map
}
[ToMain.SHOWS_REFRESH_BATCH]: {
  trimmed: TrimmedShows   // partial slice
}
```

The terminal `Main.READ_FOLDER` reply carries `{ done: true, requestId }`
and (for backward compat / fallback) optionally the full final map when
`special.workerIndexer === false`.

### Renderer ingestion (Media.svelte)

Existing code:

```ts
const data = await requestMain(Main.READ_FOLDER, { path, depth, captureFolderContent })
allRelevantFiles = Object.values(data).filter(...)
```

Becomes (sketch):

```ts
const accum = new Map<string, FileFolder>()
const off = subscribeToBatches(Main.READ_FOLDER, requestId, (batch) => {
  for (const e of batch.entries) accum.set(e.path, e)
  // recompute allRelevantFiles from accum (cheap; entries are already filtered)
})
await requestMain(Main.READ_FOLDER, { path, depth, captureFolderContent, requestId })
off()
allRelevantFiles = filterFinal(Array.from(accum.values()))
```

Stale-request handling (`requesting++ / currentRequest`) is preserved by
using `requestId` as the cancellation key — old batches are ignored.

## Error Handling

- **Worker crash (Phase 2):** `IndexerService` listens on `exit`. On crash:
  fails all in-flight requests with a clear error, logs the exit code,
  respawns the worker. Renderer falls back gracefully (existing
  `requestMain` 15s timeout already handles hung requests).
- **Permission error / EACCES on a subfolder:** caught per-entry, logged,
  skipped — does not abort the whole walk.
- **ffmpeg failure on a single file:** unchanged from current behavior
  (existing `failedPaths` set in `thumbnails.ts`).
- **Feature-flag rollback:** `$special.workerIndexer === false` short-
  circuits in `IPC/responsesMain.ts` to call the old synchronous-ish
  path. Setting toggle in Settings → Other.

## Testing

- **Unit (existing test runner, scripts/tests/):** add
  `scripts/tests/dir-walker.test.mjs` exercising `DirWalker` against a
  fixture folder tree (1k files, deep nesting). Assert: emits batches,
  yields between batches, total count matches, errors per-entry don't
  abort.
- **Unit:** `scripts/tests/show-parser.test.mjs` — parse 200 fixture
  `.show` files, assert chunked output and identical TrimmedShow
  semantics vs. current synchronous code.
- **Manual / e2e:** open a 5k-image folder. Expected: UI thread stays
  responsive (can scroll, can switch tabs); outputs do not stutter;
  results render incrementally.
- **Regression:** existing playwright tests must still pass.

## Performance budget

- Main process: zero synchronous file I/O on hot indexing paths.
  `refreshAllShows` becomes fully async with cooperative yield.
- Each renderer batch ingestion: <16ms compute (one frame budget).
- IPC payload per batch: ~200 entries × ~200 bytes = ~40KB,
  vs. current single-shot multi-MB payload.

## Files Affected

**New:**
- `src/electron/indexer/IndexerService.ts` (Phase 2)
- `src/electron/indexer/worker.ts` (Phase 2)
- `src/electron/indexer/DirWalker.ts` (Phase 1 — used in-process; Phase 2 — used in worker)
- `src/electron/indexer/ShowParser.ts` (same)
- `scripts/tests/dir-walker.test.mjs` (Phase 1)
- `scripts/tests/show-parser.test.mjs` (Phase 1)

**Modified:**
- `src/electron/utils/files.ts` — `readFolderContent` becomes a thin
  caller into `DirWalker` with a streaming callback.
- `src/electron/utils/shows.ts` — `refreshAllShows` async + chunked.
- `src/electron/IPC/responsesMain.ts` — `[Main.READ_FOLDER]` becomes
  the streaming proxy; new `READ_FOLDER_BATCH` push channel emitter.
- `src/types/IPC/ToMain.ts` — add `READ_FOLDER_BATCH`, `SHOWS_REFRESH_BATCH`.
- `src/types/IPC/Main.ts` — `READ_FOLDER` payload gains `requestId`,
  reply gains `done`/`entries` discriminator.
- `src/frontend/IPC/main.ts` — add `subscribeToBatches(channel, requestId, handler)`.
- `src/frontend/components/drawer/media/Media.svelte` — incremental
  ingestion.
- `src/frontend/components/drawer/navigation/MediaTabs.svelte` — same
  pattern (smaller payloads, but same code path).
- `src/frontend/IPC/responsesMain.ts` — handle `READ_FOLDER_BATCH`,
  `SHOWS_REFRESH_BATCH`.
- `src/frontend/components/settings/values/special.ts` (or wherever
  the special toggle lives) — add `workerIndexer` boolean (default true).
- `src/electron/data/thumbnails.ts` — Phase 2: factor ffmpeg queue
  into `ThumbnailService`, keep public surface stable.

## Risks

1. **Renderer-side merge cost.** If batches are too small, renderer pays
   per-batch reactive overhead. Mitigation: batch size = 200 entries OR
   subfolder boundary; renderer only triggers Svelte reactivity once per
   batch via a single `accum` reassignment.
2. **Worker init race.** First `READ_FOLDER` after app boot may arrive
   before the worker is ready. Mitigation: `IndexerService` returns a
   ready-promise; queued requests buffer until init completes.
3. **Test environment.** Playwright tests already cover the Media tab
   flow; the streaming protocol must round-trip end-to-end without test
   changes — the assertion is on final state, not on batch boundaries.
4. **Per-entry `stat` ordering.** Current code does `Promise.all` so order
   is unspecified anyway. New bounded walker preserves "no ordering
   guarantee" — renderer sorts by name in-place as today.

## Rollout

1. Land Phase 1 behind `special.workerIndexer = true` (default).
2. CCFII team smoke-tests local builds (HMR loop on dev machine).
3. Land Phase 2 behind same flag — no protocol change visible to renderer.
4. After two weeks of clean prod use, consider removing the fallback path.
