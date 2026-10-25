import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { BrowserWindow, ipcMain, session, type IpcMainEvent, type WebContents } from "electron"
import { fileURLToPath } from "url"
import type { PowerPointRenderBounds, PowerPointRendererReply, PowerPointRendererRequest, PowerPointRendererResult } from "../../types/PowerPointRenderer"

const requestChannel = "POWERPOINT_RENDERER_REQUEST"
const replyChannel = "POWERPOINT_RENDERER_REPLY"
const openTimeoutMs = 120_000
const pageTimeoutMs = 30_000
const closeTimeoutMs = 5_000
const overallTimeoutMs = 10 * 60_000
const maxPngBytes = 16 * 1024 * 1024

type PendingRequest = {
    operation: PowerPointRendererRequest["operation"]
    resolve: (reply: PowerPointRendererReply) => void
    timer: NodeJS.Timeout
}

type UncorrelatedRequest = PowerPointRendererRequest extends infer Request ? (Request extends { requestId: string; jobToken: string } ? Omit<Request, "requestId" | "jobToken"> : never) : never

type RendererSession = {
    jobId: string
    jobToken: string
    window: BrowserWindow
    webContents: WebContents
    pending: Map<string, PendingRequest>
    pageCount?: number
    rendererPid: number
    uiPid?: number
    closed: boolean
    overallTimer: NodeJS.Timeout
    signal?: AbortSignal
    abort?: () => void
}

const sessions = new Map<string, RendererSession>()
let replyHandlerRegistered = false

function registerReplyHandler() {
    if (replyHandlerRegistered) return
    replyHandlerRegistered = true
    ipcMain.on(replyChannel, (event: IpcMainEvent, reply: PowerPointRendererReply) => {
        if (!reply || typeof reply !== "object" || typeof reply.requestId !== "string" || typeof reply.jobToken !== "string") return
        const owner = Array.from(sessions.values()).find((active) => active.webContents === event.sender)
        if (!owner || owner.closed || owner.jobToken !== reply.jobToken || event.senderFrame !== event.sender.mainFrame) return
        const pending = owner.pending.get(reply.requestId)
        if (!pending || pending.operation !== reply.operation) return
        owner.pending.delete(reply.requestId)
        clearTimeout(pending.timer)
        pending.resolve(reply)
    })
}

function abortError() {
    const error = new Error("PowerPoint import cancelled")
    error.name = "AbortError"
    return error
}

function failPending(session: RendererSession, error: Error) {
    for (const pending of session.pending.values()) {
        clearTimeout(pending.timer)
        pending.resolve({ operation: pending.operation, requestId: "", jobToken: session.jobToken, error: error.message })
    }
    session.pending.clear()
}

function destroySession(session: RendererSession, error: Error, forceCrash = false) {
    if (session.closed) return
    session.closed = true
    clearTimeout(session.overallTimer)
    if (session.abort) session.signal?.removeEventListener("abort", session.abort)
    failPending(session, error)
    if (sessions.get(session.jobId) === session) sessions.delete(session.jobId)
    if (!session.window.isDestroyed()) {
        if (forceCrash) {
            try {
                session.webContents.forcefullyCrashRenderer()
            } catch {
                // Destroy still tears down the isolated renderer when it already exited.
            }
        }
        session.window.destroy()
    }
    void session.webContents.session.clearStorageData().catch(() => {})
    void session.webContents.session.clearCache().catch(() => {})
}

function validatePng(png: ArrayBuffer, width: number, height: number) {
    const bytes = new Uint8Array(png)
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length < 24 || bytes.length > maxPngBytes || signature.some((value, index) => bytes[index] !== value)) throw new Error("The renderer returned an invalid or oversized PNG")
    if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("The renderer returned a PNG without an IHDR header")
    const pngWidth = new DataView(png).getUint32(16)
    const pngHeight = new DataView(png).getUint32(20)
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1920 || height > 1080 || width * height > 1920 * 1080) {
        throw new Error("The renderer returned a slide outside the 1920 × 1080 image limit")
    }
    if (pngWidth !== width || pngHeight !== height) throw new Error("The renderer returned PNG dimensions that did not match its response")
}

function sendRequest<T extends PowerPointRendererResult>(session: RendererSession, request: UncorrelatedRequest, timeoutMs: number): Promise<T> {
    if (session.closed || session.window.isDestroyed()) return Promise.reject(new Error("The PowerPoint renderer is no longer available"))
    const requestId = randomUUID()
    const message = { ...request, requestId, jobToken: session.jobToken } as PowerPointRendererRequest

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            session.pending.delete(requestId)
            const error = new Error(`The PowerPoint renderer did not answer ${message.operation} within ${timeoutMs / 1000} seconds`)
            destroySession(session, error, true)
            reject(error)
        }, timeoutMs)
        session.pending.set(requestId, {
            operation: message.operation,
            timer,
            resolve: (reply) => {
                if (reply.error) reject(new Error(reply.error))
                else resolve(reply.result as T)
            }
        })
        session.webContents.send(requestChannel, message)
    })
}

function rendererSitePath() {
    return path.join(__dirname, "../powerpointRenderer/site")
}

function rendererPagePath() {
    return path.join(rendererSitePath(), "index.html")
}

function rendererPreloadPath() {
    return path.join(__dirname, "../powerpointRenderer/preload.js")
}

function assertDifferentRendererProcess(window: BrowserWindow, uiWebContents?: WebContents | null) {
    if (!uiWebContents || uiWebContents.isDestroyed()) return
    const uiPid = uiWebContents.getOSProcessId()
    const rendererPid = window.webContents.getOSProcessId()
    if (!uiPid || !rendererPid || uiPid === rendererPid) throw new Error("PowerPoint rendering could not be isolated from the FreeShow window")
}

export async function openPowerPointRenderer(options: { jobId: string; sourcePath: string; signal?: AbortSignal; uiWebContents?: WebContents | null }) {
    registerReplyHandler()
    if (sessions.has(options.jobId)) throw new Error("A PowerPoint renderer job already exists")
    if (options.signal?.aborted) throw abortError()

    const jobToken = randomUUID()
    const partitionName = `powerpoint-${jobToken}`
    const isolatedSession = session.fromPartition(partitionName)
    isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    isolatedSession.setPermissionCheckHandler(() => false)
    isolatedSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
        if (details.url.startsWith("file://")) {
            let localPath = ""
            try {
                localPath = fileURLToPath(details.url)
            } catch {
                callback({ cancel: true })
                return
            }
            const normalizedRoot = path.resolve(rendererSitePath())
            const normalizedPath = path.resolve(localPath)
            callback({ cancel: normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`) })
            return
        }
        callback({ cancel: !details.url.startsWith("data:") && !details.url.startsWith("blob:") })
    })

    const window = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
            preload: rendererPreloadPath(),
            partition: partitionName,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            additionalArguments: [`--ppt-job-token=${jobToken}`]
        }
    })
    let renderSession: RendererSession
    renderSession = {
        jobId: options.jobId,
        jobToken,
        window,
        webContents: window.webContents,
        pending: new Map(),
        closed: false,
        overallTimer: setTimeout(() => destroySession(renderSession, new Error("PowerPoint import exceeded the 10 minute time limit"), true), overallTimeoutMs),
        signal: options.signal,
        rendererPid: 0,
        uiPid: options.uiWebContents && !options.uiWebContents.isDestroyed() ? options.uiWebContents.getOSProcessId() : undefined
    }
    sessions.set(options.jobId, renderSession)

    const blockNavigation = (event: Electron.Event) => event.preventDefault()
    window.webContents.on("will-navigate", blockNavigation)
    window.webContents.on("will-redirect", blockNavigation)
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.once("render-process-gone", (_event, details) => destroySession(renderSession, new Error(`The isolated PowerPoint renderer stopped: ${details.reason}`)))
    renderSession.abort = () => destroySession(renderSession, abortError(), true)
    options.signal?.addEventListener("abort", renderSession.abort, { once: true })

    try {
        if (!fs.existsSync(rendererPagePath()) || !fs.existsSync(rendererPreloadPath())) throw new Error("The built-in PowerPoint renderer is not available. Reinstall or update FreeShow, then try again.")
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The PowerPoint renderer did not load in time")), 15_000)
            window.loadFile(rendererPagePath()).then(
                () => {
                    clearTimeout(timer)
                    resolve()
                },
                (error) => {
                    clearTimeout(timer)
                    reject(new Error(`Could not load the PowerPoint renderer: ${error instanceof Error ? error.message : String(error)}`))
                }
            )
        })
        assertDifferentRendererProcess(window, options.uiWebContents)
        renderSession.rendererPid = window.webContents.getOSProcessId()

        const source = await fs.promises.readFile(options.sourcePath, { signal: options.signal })
        const opened = await sendRequest<{ pageCount: number; rendererVersion: string }>(renderSession, { operation: "OPEN", bytes: source }, openTimeoutMs)
        if (!Number.isInteger(opened.pageCount) || opened.pageCount < 1 || opened.pageCount > 500) throw new Error("The .pptx file does not contain a supported number of slides")
        renderSession.pageCount = opened.pageCount
        return { pageCount: opened.pageCount, rendererVersion: opened.rendererVersion }
    } catch (error) {
        destroySession(renderSession, error instanceof Error ? error : new Error(String(error)), true)
        throw error
    }
}

export async function renderPowerPointPage(jobId: string, pageIndex: number, bounds: PowerPointRenderBounds) {
    const renderSession = sessions.get(jobId)
    if (!renderSession || renderSession.closed || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= (renderSession.pageCount || 0)) throw new Error("The PowerPoint page index is not valid for this render job")
    const page = await sendRequest<{ pageIndex: number; png: ArrayBuffer; width: number; height: number }>(renderSession, { operation: "PAGE", pageIndex, bounds }, pageTimeoutMs)
    if (page.pageIndex !== pageIndex) throw new Error("The PowerPoint renderer returned a different page than requested")
    validatePng(page.png, page.width, page.height)
    return page
}

export async function closePowerPointRenderer(jobId: string) {
    const renderSession = sessions.get(jobId)
    if (!renderSession) return { closed: true as const }
    try {
        const result = await sendRequest<{ closed: true }>(renderSession, { operation: "CLOSE" }, closeTimeoutMs)
        return result
    } finally {
        destroySession(renderSession, new Error("The PowerPoint render session is closed"))
    }
}

export function abortPowerPointRenderer(jobId: string) {
    const renderSession = sessions.get(jobId)
    if (renderSession) destroySession(renderSession, abortError(), true)
}

export function getPowerPointRendererSessionCount() {
    return sessions.size
}

export function getPowerPointRendererPids(jobId: string) {
    const renderSession = sessions.get(jobId)
    return renderSession ? { rendererPid: renderSession.rendererPid, uiPid: renderSession.uiPid } : undefined
}
