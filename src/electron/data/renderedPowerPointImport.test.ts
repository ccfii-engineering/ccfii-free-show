import { EventEmitter } from "events"
import { spawn } from "child_process"
import { existsSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PassThrough } from "stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../IPC/main", () => ({ requestToMainResult: vi.fn(), sendToMain: vi.fn() }))
vi.mock("../utils/files", () => ({ getDataFolderRoot: () => "/tmp", sanitizeFileName: (name: string) => name }))

import { buildImportCacheKey, findReusableRenderedPages, rerenderImportedSource, resolveManagedImportPath, runOwnedCommand, runRenderedImportJob, runWithRendererLock, shouldUseRenderedPowerPointImport, type RenderImportDependencies } from "./renderedPowerPointImport"

describe("rendered PowerPoint import", () => {
    let tempRoot = ""
    let dataRoot = ""

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "freeshow-ppt-import-"))
        dataRoot = path.join(tempRoot, "managed")
        await fs.mkdir(path.join(tempRoot, "input"), { recursive: true })
    })

    afterEach(async () => {
        await fs.rm(tempRoot, { recursive: true, force: true })
    })

    function makeDependencies(overrides: Partial<RenderImportDependencies> = {}) {
        let nextJobId = 0
        const shows: { images: string[]; name: string; source: any }[] = []
        const progress: any[] = []
        const dependencies: RenderImportDependencies = {
            dataRoot,
            createJobId: () => `job-${++nextJobId}`,
            preflightPowerPoint: async () => ({ pageCount: 3 }),
            openPowerPoint: async () => ({ pageCount: 3, rendererVersion: "@web-ppt/core test 0.4.5; Electron test; Chromium test" }),
            openPdf: async () => ({ pageCount: 3, rendererVersion: "PDF.js test 1.0" }),
            renderPage: async () => ({ png: Uint8Array.from([137, 80, 78, 71]).buffer, width: 1, height: 1 }),
            renderPowerPointPage: async () => ({ png: Uint8Array.from([137, 80, 78, 71]).buffer, width: 1, height: 1 }),
            closePdf: async () => {},
            closePowerPoint: async () => {},
            progress: (value) => progress.push(value),
            createShow: (value) => shows.push(value),
            ...overrides
        }
        return { dependencies, shows, progress }
    }

    async function createInput(name = "service.pptx") {
        const inputPath = path.join(tempRoot, "input", name)
        await fs.writeFile(inputPath, `presentation ${name}`)
        return inputPath
    }

    it("writes each PNG before requesting the next page and keeps movable source references", async () => {
        const inputPath = await createInput()
        let activeRenders = 0
        let maxActiveRenders = 0
        let requestedResolution: RenderImportDependencies["renderPage"] extends (...args: infer T) => any ? T[2] : never
        const { dependencies, shows } = makeDependencies({
            renderPowerPointPage: async (jobId, pageIndex, resolution) => {
                requestedResolution = resolution
                activeRenders++
                maxActiveRenders = Math.max(maxActiveRenders, activeRenders)
                if (pageIndex > 0) {
                    const priorPage = path.join(dataRoot, "imports", "PowerPoint", jobId, `page-${String(pageIndex).padStart(4, "0")}.png`)
                    expect(existsSync(priorPage)).toBe(true)
                }
                await Promise.resolve()
                activeRenders--
                return { png: Uint8Array.from([137, 80, 78, 71, pageIndex]).buffer, width: 1280, height: 720 }
            }
        })

        const result = await runRenderedImportJob(inputPath, "powerpoint", undefined, dependencies)
        expect(result.status).toBe("complete")
        if (result.status !== "complete") return
        expect(result.pages).toBe(3)
        expect(requestedResolution).toEqual({ maxWidth: 1920, maxHeight: 1080, maxPixels: 1920 * 1080 })
        expect(maxActiveRenders).toBe(1)
        expect(shows).toHaveLength(1)
        expect(shows[0].source).toEqual(result.source)
        expect(result.source.sourcePath.startsWith("/")).toBe(false)
        expect(result.source).not.toHaveProperty("pdfPath")
        expect(result.source.pagePaths.every((filePath) => !filePath.startsWith("/"))).toBe(true)
        const manifest = JSON.parse(await fs.readFile(path.join(dataRoot, result.source.pagePaths[0], "..", "manifest.json"), "utf8"))
        expect(manifest.source).toEqual(result.source)

        await fs.rm(inputPath)
        expect(existsSync(resolveManagedImportPath(dataRoot, result.source.sourcePath))).toBe(true)
        expect(await findReusableRenderedPages(result.source, dataRoot)).toHaveLength(3)
    })

    it("rerenders an older PowerPoint source without requiring its PDF and invalidates the previous renderer cache", async () => {
        const inputPath = await createInput()
        const { dependencies } = makeDependencies()
        const imported = await runRenderedImportJob(inputPath, "powerpoint", undefined, dependencies)
        expect(imported.status).toBe("complete")
        if (imported.status !== "complete") return
        await fs.rm(inputPath)

        let rendererSource = ""
        const rerenderDependencies = makeDependencies({
            createJobId: () => "rerender-job",
            openPowerPoint: async (jobId, sourcePath) => {
                rendererSource = sourcePath
                expect(existsSync(sourcePath)).toBe(true)
                expect(jobId).toBe("rerender-job")
                return { pageCount: 3, rendererVersion: "@web-ppt/core test 0.4.6; Electron test; Chromium test" }
            },
            renderPowerPointPage: async () => ({ png: Uint8Array.from([137, 80, 78, 71]).buffer, width: 1280, height: 720 })
        })
        const legacyPowerPointSource = { ...imported.source, pdfPath: undefined, renderer: "LibreOffice + PDF.js", rendererVersion: "LibreOffice old; PDF.js old" }
        const rerendered = await rerenderImportedSource(legacyPowerPointSource, undefined, rerenderDependencies.dependencies)

        expect(rendererSource).toBe(resolveManagedImportPath(dataRoot, imported.source.sourcePath))
        expect(rerendered.source.cacheKey).not.toBe(imported.source.cacheKey)
        expect(rerendered.source.sourcePath).toBe(imported.source.sourcePath)
        expect(rerendered.source.pagePaths).not.toEqual(imported.source.pagePaths)
        expect(rerenderDependencies.shows).toHaveLength(0)
        expect(await findReusableRenderedPages(rerendered.source, dataRoot)).toHaveLength(3)
    })

    it("does not create a show and removes only its incomplete job on a page failure", async () => {
        const inputPath = await createInput()
        const completedFolder = path.join(dataRoot, "imports", "PowerPoint", "completed-job")
        await fs.mkdir(completedFolder, { recursive: true })
        await fs.writeFile(path.join(completedFolder, "manifest.json"), "completed")
        const { dependencies, shows } = makeDependencies({
            renderPowerPointPage: async (_jobId, pageIndex) => {
                if (pageIndex === 1) throw new Error("controlled render failure")
                return { png: new ArrayBuffer(4), width: 1, height: 1 }
            }
        })

        const result = await runRenderedImportJob(inputPath, "powerpoint", undefined, dependencies)
        expect(result).toMatchObject({ status: "error", message: "controlled render failure" })
        expect(shows).toHaveLength(0)
        expect(existsSync(path.join(dataRoot, "imports", "PowerPoint", "job-1"))).toBe(false)
        expect(existsSync(path.join(completedFolder, "manifest.json"))).toBe(true)
    })

    it("closes the isolated PowerPoint renderer after cancellation and preserves completed imports", async () => {
        const inputPath = await createInput()
        const completedFolder = path.join(dataRoot, "imports", "PowerPoint", "older-job")
        await fs.mkdir(completedFolder, { recursive: true })
        await fs.writeFile(path.join(completedFolder, "manifest.json"), "completed")
        const controller = new AbortController()
        let started!: () => void
        const renderStarted = new Promise<void>((resolve) => (started = resolve))
        const closePowerPoint = vi.fn(async () => {})
        const { dependencies, shows } = makeDependencies({
            renderPowerPointPage: async (_jobId, _pageIndex, _resolution, signal) =>
                new Promise((_, reject) => {
                    started()
                    signal?.addEventListener(
                        "abort",
                        () => {
                            const error = new Error("cancelled")
                            error.name = "AbortError"
                            reject(error)
                        },
                        { once: true }
                    )
                }),
            closePowerPoint
        })

        const pending = runRenderedImportJob(inputPath, "powerpoint", controller.signal, dependencies)
        await renderStarted
        controller.abort()
        const result = await pending

        expect(result.status).toBe("cancelled")
        expect(closePowerPoint).toHaveBeenCalledWith("job-1")
        expect(shows).toHaveLength(0)
        expect(existsSync(path.join(dataRoot, "imports", "PowerPoint", "job-1"))).toBe(false)
        expect(existsSync(path.join(completedFolder, "manifest.json"))).toBe(true)
    })

    it("surfaces portable renderer errors without asking for LibreOffice or downgrading to editable", async () => {
        const inputPath = await createInput()
        const { dependencies, shows } = makeDependencies({
            preflightPowerPoint: async () => {
                throw new Error("The built-in PowerPoint renderer is not available")
            }
        })

        const result = await runRenderedImportJob(inputPath, "powerpoint", undefined, dependencies)
        expect(result.status).toBe("error")
        expect(result.message).toContain("built-in PowerPoint renderer")
        expect(shows).toHaveLength(0)
        expect(existsSync(path.join(dataRoot, "imports", "PowerPoint", "job-1"))).toBe(false)
    })

    it("rejects legacy and macro-enabled PowerPoint formats with a direct save-as action", async () => {
        for (const extension of ["ppt", "pptm"]) {
            const inputPath = await createInput(`unsupported.${extension}`)
            const preflightPowerPoint = vi.fn(async () => ({ pageCount: 1 }))
            const { dependencies, shows } = makeDependencies({ preflightPowerPoint })
            const result = await runRenderedImportJob(inputPath, "powerpoint", undefined, dependencies)

            expect(result.status).toBe("error")
            expect(result.message).toContain("Save this presentation as .pptx")
            expect(preflightPowerPoint).not.toHaveBeenCalled()
            expect(shows).toHaveLength(0)
        }
    })

    it("keeps same-named imports in distinct managed folders and dispatches only PowerPoint by default", async () => {
        const first = await createInput("duplicate.pptx")
        const secondDirectory = path.join(tempRoot, "other-input")
        await fs.mkdir(secondDirectory)
        const second = path.join(secondDirectory, "duplicate.pptx")
        await fs.writeFile(second, "different presentation")
        const { dependencies } = makeDependencies()

        const firstResult = await runRenderedImportJob(first, "powerpoint", undefined, dependencies)
        const secondResult = await runRenderedImportJob(second, "powerpoint", undefined, dependencies)
        expect(firstResult.status).toBe("complete")
        expect(secondResult.status).toBe("complete")
        if (firstResult.status === "complete" && secondResult.status === "complete") {
            expect(firstResult.source.sourcePath).not.toBe(secondResult.source.sourcePath)
            expect(firstResult.source.cacheKey).not.toBe(secondResult.source.cacheKey)
        }

        expect(shouldUseRenderedPowerPointImport("powerpoint")).toBe(true)
        expect(shouldUseRenderedPowerPointImport("powerpoint", "rendered")).toBe(true)
        expect(shouldUseRenderedPowerPointImport("powerpoint", "editable")).toBe(false)
        expect(shouldUseRenderedPowerPointImport("pdf")).toBe(false)
        expect(buildImportCacheKey("source", "web-ppt A; Electron A; Chromium A")).not.toBe(buildImportCacheKey("source", "web-ppt A; Electron A; Chromium B"))
        expect(buildImportCacheKey("source", "web-ppt A; Electron A; Chromium A")).not.toBe(buildImportCacheKey("source", "web-ppt B; Electron A; Chromium A"))
    })

    it("imports a manual PDF with PDF.js and keeps PDF paths required", async () => {
        const inputPath = await createInput("source.pdf")
        const preflightPowerPoint = vi.fn()
        const { dependencies, shows } = makeDependencies({
            preflightPowerPoint,
            openPdf: async () => ({ pageCount: 1, rendererVersion: "PDF.js test 1.0" })
        })

        const result = await runRenderedImportJob(inputPath, "pdf", undefined, dependencies)
        expect(result.status).toBe("complete")
        expect(preflightPowerPoint).not.toHaveBeenCalled()
        expect(shows[0].source.kind).toBe("pdf")
        expect(shows[0].source.sourcePath).toBe(shows[0].source.pdfPath)
    })

    it("serializes renderer jobs across independent callers", async () => {
        const events: string[] = []
        const job = (name: string) =>
            runWithRendererLock(undefined, async () => {
                events.push(`open:${name}`)
                await new Promise((resolve) => setTimeout(resolve, 5))
                events.push(`page:${name}`)
                events.push(`close:${name}`)
            })

        await Promise.all([job("first"), job("second")])
        expect(events).toEqual(["open:first", "page:first", "close:first", "open:second", "page:second", "close:second"])
    })

    it("does not start a queued renderer job after its caller cancels", async () => {
        let releaseFirst!: () => void
        const firstBlock = new Promise<void>((resolve) => (releaseFirst = resolve))
        const controller = new AbortController()
        const queuedAction = vi.fn(async () => {})
        const first = runWithRendererLock(undefined, () => firstBlock)
        const queued = runWithRendererLock(controller.signal, queuedAction)
        controller.abort()
        releaseFirst()

        await first
        await expect(queued).rejects.toMatchObject({ name: "AbortError" })
        expect(queuedAction).not.toHaveBeenCalled()
    })

    it("cleans an aborted PowerPoint job before starting the next queued import", async () => {
        const firstInput = await createInput("abort.pptx")
        const nextInput = await createInput("next.pptx")
        const controller = new AbortController()
        let renderStarted!: () => void
        const started = new Promise<void>((resolve) => (renderStarted = resolve))
        const firstDependencies = makeDependencies({
            createJobId: () => "abort-job",
            renderPowerPointPage: async (_jobId, _pageIndex, _resolution, signal) =>
                new Promise((_, reject) => {
                    renderStarted()
                    signal?.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true })
                })
        })
        const nextDependencies = makeDependencies({ createJobId: () => "next-job" })
        const first = runWithRendererLock(controller.signal, () => runRenderedImportJob(firstInput, "powerpoint", controller.signal, firstDependencies.dependencies))

        await started
        const next = runWithRendererLock(undefined, () => runRenderedImportJob(nextInput, "powerpoint", undefined, nextDependencies.dependencies))
        controller.abort()

        const [firstResult, nextResult] = await Promise.all([first, next])
        expect(firstResult.status).toBe("cancelled")
        expect(nextResult.status).toBe("complete")
        expect(existsSync(path.join(dataRoot, "imports", "PowerPoint", "abort-job"))).toBe(false)
        expect(existsSync(path.join(dataRoot, "imports", "PowerPoint", "next-job", "manifest.json"))).toBe(true)
        expect(firstDependencies.shows).toHaveLength(0)
        expect(nextDependencies.shows).toHaveLength(1)
    })

    it("uses PID-scoped Windows tree termination for abort and timeout", async () => {
        const killCalls: { command: string; args: string[] }[] = []
        const ownedChildren: any[] = []
        const createChild = (pid: number) => {
            const child: any = new EventEmitter()
            child.pid = pid
            child.stdout = new PassThrough()
            child.stderr = new PassThrough()
            child.kill = vi.fn((signal: string) => {
                setImmediate(() => {
                    child.stdout.end()
                    child.stderr.end()
                    child.emit("close", 1)
                })
                return true
            })
            return child
        }
        let nextPid = 4100
        let currentOwnedChild: any
        const spawnProcess = vi.fn((command: string, args: string[]) => {
            if (command === "soffice.exe") {
                currentOwnedChild = createChild(++nextPid)
                ownedChildren.push(currentOwnedChild)
                return currentOwnedChild
            }

            killCalls.push({ command, args })
            const taskkill = createChild(++nextPid)
            setImmediate(() => {
                taskkill.stdout.end()
                taskkill.stderr.end()
                taskkill.emit("close", 0)
                currentOwnedChild.stdout.end()
                currentOwnedChild.stderr.end()
                currentOwnedChild.emit("close", 1)
            })
            return taskkill
        }) as unknown as typeof spawn

        const controller = new AbortController()
        const aborted = runOwnedCommand("soffice.exe", ["--convert-to", "pdf"], controller.signal, 10_000, 20, { platform: "win32", spawnProcess })
        controller.abort()
        await expect(aborted).rejects.toMatchObject({ name: "AbortError" })

        const timedOut = runOwnedCommand("soffice.exe", ["--convert-to", "pdf"], undefined, 10, 20, { platform: "win32", spawnProcess })
        await expect(timedOut).rejects.toThrow("Process timed out")

        expect(killCalls).toEqual([
            { command: "taskkill.exe", args: ["/PID", "4101", "/T", "/F"] },
            { command: "taskkill.exe", args: ["/PID", "4103", "/T", "/F"] }
        ])
        expect(ownedChildren.every((child) => !child.kill.mock.calls.length)).toBe(true)
    })

    it("bounds the Windows tree terminator and then force-closes only the owned root", async () => {
        const spawnCalls: { command: string; args: string[] }[] = []
        const createChild = (pid: number, killCloses = false) => {
            const child: any = new EventEmitter()
            child.pid = pid
            child.stdout = new PassThrough()
            child.stderr = new PassThrough()
            child.kill = vi.fn((signal: string) => {
                if (killCloses) {
                    setImmediate(() => {
                        child.stdout.end()
                        child.stderr.end()
                        child.emit("close", 1)
                    })
                }
                return true
            })
            return child
        }
        const owned = createChild(5101, true)
        const terminators: any[] = []
        const spawnProcess = vi.fn((command: string, args: string[]) => {
            spawnCalls.push({ command, args })
            if (command === "soffice.exe") return owned
            const terminator = createChild(6000 + terminators.length, true)
            terminators.push(terminator)
            return terminator
        }) as unknown as typeof spawn

        const controller = new AbortController()
        const pending = runOwnedCommand("soffice.exe", [], controller.signal, 10_000, 10, { platform: "win32", spawnProcess, taskkillTimeoutMs: 10 })
        controller.abort()

        await expect(pending).rejects.toMatchObject({ name: "AbortError" })
        expect(spawnCalls.slice(1)).toEqual([
            { command: "taskkill.exe", args: ["/PID", "5101", "/T", "/F"] },
            { command: "taskkill.exe", args: ["/PID", "5101", "/T", "/F"] }
        ])
        expect(terminators).toHaveLength(2)
        expect(terminators.every((child) => child.kill.mock.calls.some(([signal]) => signal === "SIGKILL"))).toBe(true)
        expect(owned.kill.mock.calls).toEqual([["SIGKILL"]])
    })

    it.skipIf(process.platform === "win32")("kills a POSIX converter descendant without touching an unrelated process", async () => {
        const childPidFile = path.join(tempRoot, "descendant.pid")
        const unrelated = spawn(process.execPath, ["-e", `setInterval(() => {}, 1000)`], { stdio: "ignore" })
        const script = `const fs = require("fs"); const { spawn } = require("child_process"); const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: "ignore" }); fs.writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid)); setInterval(() => {}, 1000)`
        const controller = new AbortController()
        const pending = runOwnedCommand(process.execPath, ["-e", script], controller.signal, 10_000, 40)

        try {
            await waitForFile(childPidFile)
            const childPid = Number(await fs.readFile(childPidFile, "utf8"))
            expect(childPid).toBeGreaterThan(0)
            controller.abort()
            await expect(pending).rejects.toMatchObject({ name: "AbortError" })
            expect(await isProcessActive(childPid)).toBe(false)
            expect(() => process.kill(unrelated.pid!, 0)).not.toThrow()
        } finally {
            unrelated.kill("SIGKILL")
        }
    })
})

async function waitForFile(filePath: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
        try {
            await fs.access(filePath)
            return
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }
    throw new Error(`Timed out waiting for ${filePath}`)
}

async function isProcessActive(pid: number) {
    if (process.platform === "linux") {
        try {
            const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8")
            const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]
            return state !== "Z" && state !== "X"
        } catch {
            return false
        }
    }

    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}
