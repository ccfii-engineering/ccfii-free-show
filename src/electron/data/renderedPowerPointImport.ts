import { createHash } from "crypto"
import { spawn } from "child_process"
import type { WebContents } from "electron"
import fs from "fs"
import path from "path"
import { uid } from "uid"
import type { PowerPointImportMode, PowerPointImportOutcome } from "../../types/IPC/Main"
import { ToMain } from "../../types/IPC/ToMain"
import type { ImportSource } from "../../types/Show"
import { requestToMainResult, sendToMain } from "../IPC/main"
import { closePowerPointRenderer, openPowerPointRenderer, renderPowerPointPage } from "./powerpointRenderer"
import { POWERPOINT_ARCHIVE_LIMITS, preflightPowerPointArchive } from "./powerpointArchivePreflight"
import { getDataFolderRoot, sanitizeFileName } from "../utils/files"

export const POWERPOINT_RENDER_RESOLUTION = { maxWidth: 1920, maxHeight: 1080, maxPixels: 1920 * 1080 } as const

type RenderPage = { png: ArrayBuffer; width: number; height: number }
type OpenDocument = { pageCount: number; rendererVersion: string }

export interface RenderImportDependencies {
    dataRoot: string
    createJobId: () => string
    preflightPowerPoint: (sourcePath: string, signal?: AbortSignal) => Promise<{ pageCount: number }>
    openPowerPoint: (jobId: string, sourcePath: string, signal?: AbortSignal) => Promise<OpenDocument>
    openPdf: (jobId: string, pdfPath: string, signal?: AbortSignal) => Promise<OpenDocument>
    renderPage: (jobId: string, pageIndex: number, resolution: ImportSource["resolution"], signal?: AbortSignal) => Promise<RenderPage>
    renderPowerPointPage: (jobId: string, pageIndex: number, resolution: ImportSource["resolution"], signal?: AbortSignal) => Promise<RenderPage>
    closePdf: (jobId: string) => Promise<void>
    closePowerPoint: (jobId: string) => Promise<void>
    progress: (data: { filePath: string; name: string; progress: number; total: number; status: "importing" | "complete" | "error"; message?: string; jobId: string }) => void
    createShow: (data: { images: string[]; name: string; source: ImportSource }) => void
}

type ManagedImportResult = { status: "complete"; jobId: string; showName: string; pages: number; source: ImportSource; images: string[] } | Extract<PowerPointImportOutcome, { status: "cancelled" | "renderer-unavailable" | "error" }>

const rendererQueue = { tail: Promise.resolve() }

export function shouldUseRenderedPowerPointImport(id: string, mode?: PowerPointImportMode) {
    return id === "powerpoint" && mode !== "editable"
}

function abortError() {
    const error = new Error("Import cancelled")
    error.name = "AbortError"
    return error
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError()
}

function isAbortError(error: unknown, signal?: AbortSignal) {
    return signal?.aborted || (error instanceof Error && error.name === "AbortError")
}

export async function runWithRendererLock<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    const previous = rendererQueue.tail
    let release!: () => void
    rendererQueue.tail = new Promise<void>((resolve) => (release = resolve))
    await previous
    try {
        throwIfAborted(signal)
        return await action()
    } finally {
        release()
    }
}

function toManagedRef(dataRoot: string, filePath: string) {
    return path.relative(dataRoot, filePath).split(path.sep).join("/")
}

export function resolveManagedImportPath(dataRoot: string, relativePath: string) {
    const root = path.resolve(dataRoot)
    const absolutePath = path.resolve(root, relativePath)
    if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) throw new Error("Import source path is outside the managed data folder")
    return absolutePath
}

async function hashFile(filePath: string) {
    const hash = createHash("sha256")
    await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath)
        stream.on("data", (chunk) => hash.update(chunk))
        stream.once("error", reject)
        stream.once("end", resolve)
    })
    return hash.digest("hex")
}

export function buildImportCacheKey(sourceHash: string, rendererVersion: string, resolution: ImportSource["resolution"] = POWERPOINT_RENDER_RESOLUTION) {
    return createHash("sha256")
        .update(JSON.stringify({ sourceHash, rendererVersion, resolution, format: "png" }))
        .digest("hex")
}

function rendererVersionFor(kind: ImportSource["kind"], rendererVersion: string) {
    return kind === "powerpoint" ? rendererVersion : `PDF.js ${rendererVersion}`
}

function appFacingName(filePath: string) {
    return sanitizeFileName(path.basename(filePath, path.extname(filePath))) || "Presentation"
}

function createProductionDependencies(uiWebContents?: WebContents): RenderImportDependencies {
    return {
        dataRoot: getDataFolderRoot(),
        createJobId: () => uid(20),
        preflightPowerPoint: preflightPowerPointArchive,
        openPowerPoint: async (jobId, sourcePath, signal) => {
            const result = await openPowerPointRenderer({ jobId, sourcePath, signal, uiWebContents })
            return {
                pageCount: result.pageCount,
                rendererVersion: `${result.rendererVersion}; Electron ${process.versions.electron}; Chromium ${process.versions.chrome}`
            }
        },
        openPdf: async (jobId, pdfPath, signal) => {
            const result = await requestToMainResult(ToMain.PDF_RENDER_OPEN, { jobId, pdfPath }, { signal, timeoutMs: 5 * 60 * 1000 })
            return requireIPCData(result, "Could not open the converted PDF for rendering")
        },
        renderPage: async (jobId, pageIndex, resolution, signal) => {
            const result = await requestToMainResult(ToMain.PDF_RENDER_PAGE, { jobId, pageIndex, ...resolution, format: "png" }, { signal, timeoutMs: 5 * 60 * 1000 })
            return requireIPCData(result, `Could not render PDF page ${pageIndex + 1}`)
        },
        renderPowerPointPage: async (jobId, pageIndex, resolution, signal) => {
            if (signal?.aborted) throw abortError()
            return renderPowerPointPage(jobId, pageIndex, resolution)
        },
        closePdf: async (jobId) => {
            // Cleanup gets its own timeout and no already-aborted outer signal.
            await requestToMainResult(ToMain.PDF_RENDER_CLOSE, { jobId }, { timeoutMs: 15_000 })
        },
        closePowerPoint: async (jobId) => {
            await closePowerPointRenderer(jobId)
        },
        progress: (data) => sendToMain(ToMain.PDF_IMPORT_PROGRESS, data),
        createShow: (data) => sendToMain(ToMain.IMAGES_TO_SHOW, data)
    }
}

function requireIPCData<T>(result: { status: string; data?: T; error?: { message: string } }, fallbackMessage: string): T {
    if (result.status === "success" && result.data !== undefined) return result.data
    if (result.status === "cancelled") throw abortError()
    throw new Error(result.status === "error" ? result.error?.message || fallbackMessage : fallbackMessage)
}

type ChildResult = { stdout: string; stderr: string }
type OwnedCommandRuntime = { platform?: NodeJS.Platform; spawnProcess?: typeof spawn; taskkillTimeoutMs?: number }

async function hasLiveLinuxProcessInGroup(processGroupId: number) {
    const entries = await fs.promises.readdir("/proc").catch(() => [])
    for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue
        try {
            const stat = await fs.promises.readFile(`/proc/${entry}/stat`, "utf8")
            const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
            const state = fields[0]
            const groupId = Number(fields[2])
            if (groupId === processGroupId && state !== "Z" && state !== "X") return true
        } catch {
            // A process may exit between reading /proc and its stat file.
        }
    }
    return false
}

function hasLiveMacProcessInGroup(processGroupId: number) {
    return new Promise<boolean | undefined>((resolve) => {
        const ps = spawn("ps", ["-axo", "pgid=,stat="], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
        let output = ""
        let settled = false
        const finish = (result?: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve(result)
        }
        const timeout = setTimeout(() => {
            ps.kill("SIGKILL")
            finish()
        }, 1000)
        ps.stdout?.setEncoding("utf8").on("data", (data: string) => (output += data))
        ps.once("error", () => finish())
        ps.once("close", (code) => {
            if (code !== 0) return finish()
            const live = output.split("\n").some((line) => {
                const [groupId, state] = line.trim().split(/\s+/, 2)
                return Number(groupId) === processGroupId && state && state[0] !== "Z" && state[0] !== "X"
            })
            finish(live)
        })
    })
}

async function hasLiveProcessInGroup(processGroupId: number, platform: NodeJS.Platform) {
    if (platform === "linux") return hasLiveLinuxProcessInGroup(processGroupId)
    if (platform === "darwin") {
        const live = await hasLiveMacProcessInGroup(processGroupId)
        if (live !== undefined) return live
    }

    try {
        process.kill(-processGroupId, 0)
        return true
    } catch (error: any) {
        return error?.code !== "ESRCH"
    }
}

async function waitForProcessGroupCleanup(processGroupId: number, platform: NodeJS.Platform, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (!(await hasLiveProcessInGroup(processGroupId, platform))) return true
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return !(await hasLiveProcessInGroup(processGroupId, platform))
}

function runWindowsTaskkill(pid: number, spawnProcess: typeof spawn, timeoutMs: number) {
    return new Promise<boolean>((resolve) => {
        let taskkill: ReturnType<typeof spawn>
        try {
            taskkill = spawnProcess("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        } catch {
            resolve(false)
            return
        }
        let settled = false
        let closeTimeout: ReturnType<typeof setTimeout> | undefined

        const finish = (success: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            if (closeTimeout) clearTimeout(closeTimeout)
            resolve(success)
        }
        const timeout = setTimeout(() => {
            taskkill.kill("SIGKILL")
            closeTimeout = setTimeout(() => finish(false), 500)
        }, timeoutMs)

        taskkill.once("error", () => finish(false))
        taskkill.once("close", (code) => finish(code === 0))
    })
}

async function terminateWindowsProcessTree(pid: number, spawnProcess: typeof spawn, timeoutMs: number) {
    // taskkill is scoped to this spawned converter PID and its descendants, never by image name.
    if (await runWindowsTaskkill(pid, spawnProcess, timeoutMs)) return true
    return runWindowsTaskkill(pid, spawnProcess, timeoutMs)
}

export function runOwnedCommand(command: string, args: string[], signal?: AbortSignal, timeoutMs = 10 * 60 * 1000, terminationGraceMs = 2000, runtime: OwnedCommandRuntime = {}): Promise<ChildResult> {
    throwIfAborted(signal)

    return new Promise((resolve, reject) => {
        const platform = runtime.platform || process.platform
        const isolatedProcessGroup = platform !== "win32"
        const spawnProcess = runtime.spawnProcess || spawn
        const child = spawnProcess(command, args, { detached: isolatedProcessGroup, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
        let stdout = ""
        let stderr = ""
        let settled = false
        let timedOut = false
        let stopping = false
        let stopActionFinished = false
        let childClosed = false
        let stopFailure: Error | undefined
        let forceKill: ReturnType<typeof setTimeout> | undefined
        let closeWait: ReturnType<typeof setTimeout> | undefined
        let timeout: ReturnType<typeof setTimeout>

        const cleanupTimers = () => {
            clearTimeout(timeout)
            if (forceKill) clearTimeout(forceKill)
            if (closeWait) clearTimeout(closeWait)
            signal?.removeEventListener("abort", onAbort)
        }
        const settle = (error?: Error) => {
            if (settled) return
            settled = true
            cleanupTimers()
            if (error) reject(error)
            else resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
        }
        const finish = (error?: Error) => {
            if (stopping) {
                if (error) stopFailure = error
                if (!stopActionFinished || !childClosed) return
                const finalError = stopFailure || (signal?.aborted ? abortError() : timedOut ? new Error(`Process timed out after ${timeoutMs}ms`) : new Error("Process stopped"))
                settle(finalError)
                return
            }
            settle(error)
        }
        const finishStopAction = () => {
            stopActionFinished = true
            if (childClosed) {
                finish()
                return
            }
            if (closeWait) return
            closeWait = setTimeout(() => {
                child.kill("SIGKILL")
                child.stdout?.destroy()
                child.stderr?.destroy()
                childClosed = true
                finish(new Error(`Could not close the owned ${platform === "win32" ? "Windows converter process tree" : "converter process group"}`))
            }, terminationGraceMs)
        }
        const killOwnedProcess = (signal: NodeJS.Signals) => {
            if (!child.pid) return
            if (isolatedProcessGroup) {
                try {
                    process.kill(-child.pid, signal)
                    return
                } catch {
                    // Fall back to the direct child if its process group is already gone.
                }
            }
            try {
                child.kill(signal)
            } catch {
                // Process exit is finalized by the child close event.
            }
        }
        const requestStop = () => {
            if (settled || stopping) return
            stopping = true

            if (platform === "win32") {
                if (!child.pid) {
                    child.kill("SIGKILL")
                    finishStopAction()
                    return
                }

                void terminateWindowsProcessTree(child.pid, spawnProcess, runtime.taskkillTimeoutMs || 5000)
                    .then((treeKilled) => {
                        if (!treeKilled) child.kill("SIGKILL")
                        finishStopAction()
                    })
                    .catch((error) => {
                        stopFailure = error instanceof Error ? error : new Error(String(error))
                        child.kill("SIGKILL")
                        finishStopAction()
                    })
                return
            }

            killOwnedProcess("SIGTERM")
            forceKill = setTimeout(() => {
                killOwnedProcess("SIGKILL")
                void (async () => {
                    if (child.pid) {
                        let cleaned = await waitForProcessGroupCleanup(child.pid, platform).catch(() => false)
                        if (!cleaned) {
                            killOwnedProcess("SIGKILL")
                            cleaned = await waitForProcessGroupCleanup(child.pid, platform, 2000).catch(() => false)
                        }
                        if (!cleaned) stopFailure = new Error("Could not close the owned converter process group")
                    }
                    finishStopAction()
                })()
            }, terminationGraceMs)
        }
        const onAbort = () => requestStop()
        timeout = setTimeout(() => {
            timedOut = true
            requestStop()
        }, timeoutMs)

        child.stdout?.setEncoding("utf8").on("data", (data: string) => (stdout += data))
        child.stderr?.setEncoding("utf8").on("data", (data: string) => (stderr += data))
        child.once("error", (error) => {
            childClosed = true
            finish(error)
        })
        child.once("close", (code) => {
            childClosed = true
            if (stopping) return finish()
            if (signal?.aborted) return finish(abortError())
            if (timedOut) return finish(new Error(`Process timed out after ${timeoutMs}ms`))
            if (code !== 0) return finish(new Error(stderr || `${path.basename(command)} exited with code ${code}`))
            finish()
        })
        signal?.addEventListener("abort", onAbort, { once: true })
        if (signal?.aborted) onAbort()
    })
}

async function fileExists(filePath: string) {
    try {
        const stat = await fs.promises.stat(filePath)
        return stat.isFile()
    } catch {
        return false
    }
}

async function renderDocumentIntoJob(options: { kind: ImportSource["kind"]; sourcePath: string; pdfPath?: string; jobId: string; jobFolder: string; sourceHash: string; name: string; progressFilePath?: string; resolution?: ImportSource["resolution"]; createShow?: boolean; signal?: AbortSignal; dependencies: RenderImportDependencies }): Promise<{ source: ImportSource; images: string[]; pageCount: number }> {
    const { kind, sourcePath, pdfPath, jobId, jobFolder, sourceHash, name, signal, dependencies } = options
    const progressFilePath = options.progressFilePath || sourcePath
    let closeAttempted = false

    try {
        throwIfAborted(signal)
        closeAttempted = true
        if (kind === "pdf" && !pdfPath) throw new Error("A PDF path is required to render a PDF import")
        const opened = kind === "powerpoint" ? await dependencies.openPowerPoint(jobId, sourcePath, signal) : await dependencies.openPdf(jobId, pdfPath!, signal)
        if (!Number.isInteger(opened.pageCount) || opened.pageCount < 1) throw new Error(kind === "powerpoint" ? "The .pptx file does not contain any slides" : "The PDF contains no pages")

        const resolution = options.resolution || POWERPOINT_RENDER_RESOLUTION
        const rendererVersion = rendererVersionFor(kind, opened.rendererVersion)
        const cacheKey = buildImportCacheKey(sourceHash, rendererVersion, resolution)
        const images: string[] = []
        const pagePaths: string[] = []

        dependencies.progress({ filePath: progressFilePath, name, progress: 10, total: 100, status: "importing", jobId })
        for (let pageIndex = 0; pageIndex < opened.pageCount; pageIndex++) {
            throwIfAborted(signal)
            const page = kind === "powerpoint" ? await dependencies.renderPowerPointPage(jobId, pageIndex, resolution, signal) : await dependencies.renderPage(jobId, pageIndex, resolution, signal)
            const imagePath = path.join(jobFolder, `page-${String(pageIndex + 1).padStart(4, "0")}.png`)
            await fs.promises.writeFile(imagePath, Buffer.from(page.png))
            images.push(imagePath)
            pagePaths.push(toManagedRef(dependencies.dataRoot, imagePath))
            dependencies.progress({ filePath: progressFilePath, name, progress: 10 + Math.round(((pageIndex + 1) / opened.pageCount) * 80), total: 100, status: "importing", jobId })
        }

        throwIfAborted(signal)
        const source: ImportSource = {
            kind,
            sourcePath: toManagedRef(dependencies.dataRoot, sourcePath),
            ...(kind === "pdf" ? { pdfPath: toManagedRef(dependencies.dataRoot, pdfPath!) } : {}),
            sourceHash,
            renderer: kind === "powerpoint" ? "web-ppt (static PNG)" : "PDF.js",
            rendererVersion,
            resolution,
            format: "png",
            cacheKey,
            pagePaths
        }
        const manifest = { version: 1, source, createdAt: Date.now() }
        const manifestTemp = path.join(jobFolder, "manifest.json.tmp")
        await fs.promises.writeFile(manifestTemp, JSON.stringify(manifest, null, 2), "utf8")
        await fs.promises.rename(manifestTemp, path.join(jobFolder, "manifest.json"))

        throwIfAborted(signal)
        if (options.createShow !== false) dependencies.createShow({ images, name, source })
        dependencies.progress({ filePath: progressFilePath, name, progress: 100, total: 100, status: "complete", jobId })
        return { source, images, pageCount: opened.pageCount }
    } finally {
        if (closeAttempted) {
            try {
                // This request is independent of the canceled render request so PDF.js can release its document.
                if (kind === "powerpoint") await dependencies.closePowerPoint(jobId)
                else await dependencies.closePdf(jobId)
            } catch {
                // Best-effort cleanup must not mask the import result.
            }
        }
    }
}

export async function runRenderedImportJob(sourcePath: string, kind: ImportSource["kind"], signal?: AbortSignal, dependencies = createProductionDependencies()): Promise<ManagedImportResult> {
    const jobId = dependencies.createJobId()
    const name = appFacingName(sourcePath)
    const importRoot = path.join(dependencies.dataRoot, "imports", kind === "powerpoint" ? "PowerPoint" : "PDF")
    const jobFolder = path.join(importRoot, jobId)
    let ownsJobFolder = false

    try {
        throwIfAborted(signal)
        await fs.promises.mkdir(importRoot, { recursive: true })
        await fs.promises.mkdir(jobFolder, { recursive: false })
        ownsJobFolder = true

        const extension = path.extname(sourcePath) || (kind === "pdf" ? ".pdf" : "")
        if (kind === "powerpoint" && extension.toLowerCase() !== ".pptx") {
            throw new Error("Image import supports .pptx files only. Save this presentation as .pptx, then import it. Legacy .ppt and macro-enabled .pptm files are not supported in this mode.")
        }
        if (kind === "powerpoint") {
            const sourceStat = await fs.promises.stat(sourcePath)
            if (!sourceStat.isFile()) throw new Error("The PowerPoint source is not a regular file")
            if (sourceStat.size > POWERPOINT_ARCHIVE_LIMITS.maxSourceBytes) throw new Error("This .pptx file is larger than the 100 MiB import limit")
        }
        const sourceCopy = path.join(jobFolder, `source${extension.toLowerCase()}`)
        await fs.promises.copyFile(sourcePath, sourceCopy)
        const sourceHash = await hashFile(sourceCopy)
        if (kind === "powerpoint") await dependencies.preflightPowerPoint(sourceCopy, signal)

        throwIfAborted(signal)
        dependencies.progress({ filePath: sourcePath, name, progress: kind === "powerpoint" ? 5 : 0, total: 100, status: "importing", jobId })
        const rendered = await renderDocumentIntoJob({ kind, sourcePath: sourceCopy, pdfPath: kind === "pdf" ? sourceCopy : undefined, jobId, jobFolder, sourceHash, name, progressFilePath: sourcePath, signal, dependencies })
        ownsJobFolder = false
        return { status: "complete", jobId, showName: name, pages: rendered.pageCount, source: rendered.source, images: rendered.images }
    } catch (error: any) {
        if (ownsJobFolder) await fs.promises.rm(jobFolder, { recursive: true, force: true }).catch(() => {})
        const cancelled = isAbortError(error, signal)
        const message = cancelled ? "PowerPoint/PDF import cancelled" : error?.message || "The presentation could not be rendered"
        dependencies.progress({ filePath: sourcePath, name, progress: 0, total: 100, status: "error", message, jobId })
        return cancelled ? { status: "cancelled", jobId, message } : { status: "error", jobId, message }
    }
}

export async function importPowerPointFiles(files: string[], signal?: AbortSignal, uiWebContents?: WebContents): Promise<PowerPointImportOutcome | undefined> {
    if (!files.length) return

    return runWithRendererLock(signal, async () => {
        let last: ManagedImportResult | undefined
        const dependencies = createProductionDependencies(uiWebContents)
        for (const filePath of files) {
            throwIfAborted(signal)
            last = await runRenderedImportJob(filePath, "powerpoint", signal, dependencies)
            if (last.status !== "complete") return last
        }
        if (!last || last.status !== "complete") return
        return { status: "complete" as const, jobId: last.jobId, showName: last.showName, pages: last.pages }
    }).catch((error) => {
        const cancelled = isAbortError(error, signal)
        return { status: cancelled ? ("cancelled" as const) : ("error" as const), message: error instanceof Error ? error.message : String(error) }
    })
}

export async function importPDFToImageShow(filePath: string, signal?: AbortSignal): Promise<PowerPointImportOutcome | undefined> {
    return runWithRendererLock(signal, async () => {
        const result = await runRenderedImportJob(filePath, "pdf", signal)
        if (result.status !== "complete") return result
        return { status: "complete" as const, jobId: result.jobId, showName: result.showName, pages: result.pages }
    }).catch((error) => {
        const cancelled = isAbortError(error, signal)
        return { status: cancelled ? ("cancelled" as const) : ("error" as const), message: error instanceof Error ? error.message : String(error) }
    })
}

export async function findReusableRenderedPages(source: ImportSource, dataRoot = getDataFolderRoot()) {
    if (!source.pagePaths.length) return null
    const pagePaths = source.pagePaths.map((filePath) => resolveManagedImportPath(dataRoot, filePath))
    const manifestPath = path.join(path.dirname(pagePaths[0]), "manifest.json")
    try {
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as { source?: ImportSource }
        if (manifest.source?.cacheKey !== source.cacheKey) return null
        for (const pagePath of pagePaths) if (!(await fileExists(pagePath))) return null
        return pagePaths
    } catch {
        return null
    }
}

export async function rerenderImportedSource(source: ImportSource, signal?: AbortSignal, dependencies = createProductionDependencies()): Promise<{ source: ImportSource; images: string[] }> {
    return runWithRendererLock(signal, async () => {
        const sourcePath = resolveManagedImportPath(dependencies.dataRoot, source.sourcePath)
        if (!(await fileExists(sourcePath))) throw new Error("The managed presentation source is missing")
        let pdfPath: string | undefined
        if (source.kind === "pdf") {
            if (!source.pdfPath) throw new Error("The managed PDF source path is missing")
            pdfPath = resolveManagedImportPath(dependencies.dataRoot, source.pdfPath)
            if (!(await fileExists(pdfPath))) throw new Error("The managed PDF source is missing")
        } else {
            await dependencies.preflightPowerPoint(sourcePath, signal)
        }
        const sourceHash = await hashFile(sourcePath)
        if (sourceHash !== source.sourceHash) throw new Error("The managed source no longer matches its import metadata")

        const jobId = dependencies.createJobId()
        const jobFolder = path.join(dependencies.dataRoot, "imports", source.kind === "powerpoint" ? "PowerPoint" : "PDF", jobId)
        await fs.promises.mkdir(path.dirname(jobFolder), { recursive: true })
        await fs.promises.mkdir(jobFolder, { recursive: false })
        try {
            let cachedPages: string[] | null = null
            try {
                const opened = source.kind === "powerpoint" ? await dependencies.openPowerPoint(jobId, sourcePath, signal) : await dependencies.openPdf(jobId, pdfPath!, signal)
                const rendererVersion = rendererVersionFor(source.kind, opened.rendererVersion)
                const cacheKey = buildImportCacheKey(sourceHash, rendererVersion, source.resolution)
                if (cacheKey === source.cacheKey) cachedPages = await findReusableRenderedPages(source, dependencies.dataRoot)
            } finally {
                if (source.kind === "powerpoint") await dependencies.closePowerPoint(jobId).catch(() => {})
                else await dependencies.closePdf(jobId).catch(() => {})
            }

            if (cachedPages) {
                await fs.promises.rm(jobFolder, { recursive: true, force: true })
                return { source, images: cachedPages }
            }

            const result = await renderDocumentIntoJob({
                kind: source.kind,
                sourcePath,
                pdfPath,
                jobId,
                jobFolder,
                sourceHash,
                name: appFacingName(sourcePath),
                progressFilePath: sourcePath,
                resolution: source.resolution,
                createShow: false,
                signal,
                dependencies
            })
            return { source: result.source, images: result.images }
        } catch (error) {
            await fs.promises.rm(jobFolder, { recursive: true, force: true }).catch(() => {})
            throw error
        }
    })
}
