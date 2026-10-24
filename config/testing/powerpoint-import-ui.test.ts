import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import tmp from "tmp"
import { _electron as electron } from "playwright"
import { expect, test } from "@playwright/test"
import { delay, finishFirstRun, findMainWindow, launchArgs, seedWindowConfig } from "./electronTestHelpers"

const devScript = '<script type="module" src="/src/frontend/main.ts"></script>'
const productionScript = '<script type="module" crossorigin src="./build/bundle.js"></script><link rel="stylesheet" href="./build/bundle.css">'

function makePdfFixture(pageCount = 2) {
    const content = (width: number, height: number) => ["q", "1 1 1 rg", `0 0 ${width} ${height} re f`, "0 0 0 RG", "2 w", `4 4 ${width - 8} ${height - 8} re S`, "1 0 0 rg", "8 8 30 30 re f", "0 1 0 rg", `${width - 38} 8 30 30 re f`, "0 0 1 rg", `8 ${height - 38} 30 30 re f`, "1 0 1 rg", `${width - 38} ${height - 38} 30 30 re f`, "BT /F1 24 Tf 60 145 Td (PDF_RENDER_TEXT) Tj ET", "Q"].join("\n")
    const streamObject = (data: string) => `<< /Length ${Buffer.byteLength(data, "ascii")} >>\nstream\n${data}\nendstream`
    const firstPageId = 3
    const firstContentId = firstPageId + pageCount
    const fontId = firstContentId + pageCount
    const resources = `/Resources << /Font << /F1 ${fontId} 0 R >> >>`
    const pageIds = Array.from({ length: pageCount }, (_, index) => firstPageId + index)
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
        ...pageIds.map((pageId, index) => {
            const [width, height] = index % 2 ? [300, 400] : [400, 300]
            return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ${resources} /Contents ${firstContentId + index} 0 R >>`
        }),
        ...pageIds.map((_, index) => streamObject(content(...(index % 2 ? [300, 400] : [400, 300])))),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    ]

    let pdf = "%PDF-1.4\n"
    const offsets = [0]
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(pdf, "ascii"))
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    }

    const xrefOffset = Buffer.byteLength(pdf, "ascii")
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    offsets.slice(1).forEach((offset) => (pdf += `${String(offset).padStart(10, "0")} 00000 n \n`))
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
    return Buffer.from(pdf, "ascii")
}

test("PowerPoint import defaults to rendered, keeps editable advanced, offers PDF fallback, and cancels progress", async () => {
    test.setTimeout(120_000)

    const indexPath = path.join(process.cwd(), "public", "index.html")
    const originalIndex = readFileSync(indexPath, "utf8")
    const bundlePath = path.join(process.cwd(), "public", "build", "bundle.js")
    const stylesheetPath = path.join(process.cwd(), "public", "build", "bundle.css")
    if (!existsSync(bundlePath) || !existsSync(stylesheetPath)) throw new Error("Build the production frontend before running Electron UI tests")

    let changedIndex = false
    if (originalIndex.includes(devScript)) {
        writeFileSync(indexPath, originalIndex.replace(devScript, productionScript))
        changedIndex = true
    } else if (!originalIndex.includes(productionScript)) {
        throw new Error("public/index.html does not contain the expected development or production frontend entry")
    }

    const settingFolder = tmp.dirSync({ unsafeCleanup: true })
    const dataFolder = tmp.dirSync({ unsafeCleanup: true })
    seedWindowConfig(settingFolder.name)
    let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined

    try {
        electronApp = await electron.launch({ args: launchArgs(settingFolder.name), env: { ...process.env, NODE_ENV: "production" } })

        await electronApp.evaluate(({ ipcMain }) => {
            const existingHandlers = ipcMain.listeners("MAIN")
            const originalReceiver = existingHandlers.find((handler) => handler.toString().includes("receiveMain("))
            if (!originalReceiver) throw new Error("Could not locate the Electron MAIN receiver for the test interceptor")
            const state: any = {
                calls: [] as { message: any; listenerId?: string }[],
                responseMode: "unavailable" as "unavailable" | "hold",
                existingHandlers,
                originalReceiver,
                holdPageRequest: false,
                initialListenerCount: existingHandlers.length
            }
            ;(globalThis as any).__powerpointImportTest = state

            ipcMain.removeListener("MAIN", originalReceiver)
            const interceptor = (event: Electron.IpcMainEvent, message: any, listenerId?: string) => {
                if (message?.channel === "IMPORT") {
                    state.calls.push({ message, listenerId })
                    if (message.ipcRequest?.kind === "request" && state.responseMode === "unavailable") {
                        event.sender.send(
                            "MAIN",
                            {
                                channel: "IMPORT",
                                data: { status: "renderer-unavailable", jobId: "test-import", message: "LibreOffice is missing" },
                                ipcRequest: { protocol: "freeshow-ipc-request", version: 1, kind: "reply", status: "success" }
                            },
                            listenerId
                        )
                    }
                    return
                }

                originalReceiver(event, message, listenerId)
            }
            state.interceptor = interceptor
            ipcMain.prependListener("MAIN", interceptor)
        })

        await electronApp.evaluate(({ dialog }, selectedFolder) => {
            dialog.showOpenDialogSync = () => [selectedFolder]
            dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
        }, dataFolder.name)

        const mainWindow = await findMainWindow(electronApp)
        mainWindow.on("pageerror", (error) => console.error(error.stack || error.message))
        await electronApp.evaluate(({ BrowserWindow }) => {
            const state = (globalThis as any).__powerpointImportTest
            const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("index.html"))
            const webContents = window?.webContents
            if (!webContents) throw new Error("Main renderer window is unavailable")
            const originalSend = webContents.send.bind(webContents)
            webContents.send = ((channel: string, message: any, ...args: any[]) => {
                if (channel === "MAIN" && message?.channel === "PDF_RENDER_PAGE" && message.ipcRequest?.kind === "request" && state.holdPageRequest) {
                    state.holdPageRequest = false
                    setTimeout(() => originalSend(channel, message, ...args), 2000)
                    return true
                }
                return originalSend(channel, message, ...args)
            }) as typeof webContents.send
        })
        await finishFirstRun(mainWindow)

        const openImport = async () => {
            await mainWindow.keyboard.press("Control+i")
            await expect(mainWindow.getByText("PDF", { exact: true }).last()).toBeVisible({ timeout: 15_000 })
            await expect(mainWindow.getByText("PowerPoint", { exact: true }).last()).toBeVisible()
        }

        await openImport()
        await mainWindow.screenshot({ path: "/tmp/freeshow-ppt-import-desktop.png" })
        await mainWindow.setViewportSize({ width: 390, height: 844 })
        await mainWindow.screenshot({ path: "/tmp/freeshow-ppt-import-mobile.png" })
        expect(await mainWindow.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

        const powerpointOptions = mainWindow.getByText("PowerPoint", { exact: true }).last().locator("xpath=../../button").last()
        await powerpointOptions.evaluate((button) => (button as HTMLButtonElement).click())
        await expect(mainWindow.getByText("Preserve appearance", { exact: true })).toBeVisible()
        await expect(mainWindow.getByText("Editable slides", { exact: true })).toBeVisible()
        await mainWindow.screenshot({ path: "/tmp/freeshow-ppt-advanced-mobile.png" })

        await mainWindow.setViewportSize({ width: 1280, height: 900 })
        await mainWindow.screenshot({ path: "/tmp/freeshow-ppt-advanced-desktop.png" })
        await mainWindow.getByText("Editable slides", { exact: true }).click()
        await expect.poll(async () => electronApp?.evaluate(() => (globalThis as any).__powerpointImportTest.calls.some(({ message }: any) => message.data?.mode === "editable"))).toBe(true)

        const popupBack = mainWindow.locator('button[data-title="Back"]')
        if (await popupBack.count()) await popupBack.click()
        await openImport()
        await mainWindow.getByText("PowerPoint", { exact: true }).last().click()
        await expect(mainWindow.getByText("Export PDF from PowerPoint, then import that PDF into FreeShow now?", { exact: false })).toBeVisible()
        await mainWindow.getByText("Yes", { exact: true }).last().click()

        await expect.poll(async () => electronApp?.evaluate(() => (globalThis as any).__powerpointImportTest.calls.some(({ message }: any) => message.data?.mode === "rendered") && (globalThis as any).__powerpointImportTest.calls.some(({ message }: any) => message.data?.channel === "pdf"))).toBe(true)

        const cancelFixturePath = path.join(dataFolder.name, "cancel-import-fixture.pdf")
        const fixturePath = path.join(dataFolder.name, "manual-import-fixture.pdf")
        writeFileSync(cancelFixturePath, makePdfFixture(50))
        writeFileSync(fixturePath, makePdfFixture())
        await mainWindow.evaluate(() => {
            ;(window as any).__observedImageShows = []
            ;(window as any).__observedPdfProgress = []
            window.api.receive(
                "MAIN",
                (message: any) => {
                    if (message?.channel === "IMAGES_TO_SHOW") (window as any).__observedImageShows.push(message.data)
                    if (message?.channel === "PDF_IMPORT_PROGRESS") (window as any).__observedPdfProgress.push(message.data)
                },
                "powerpoint-import-source-observer"
            )
        })

        await electronApp.evaluate(({ ipcMain }) => {
            const state = (globalThis as any).__powerpointImportTest
            ipcMain.removeListener("MAIN", state.interceptor)
            ipcMain.on("MAIN", state.originalReceiver)
            state.listenerCountAfterRestore = ipcMain.listeners("MAIN").length
            state.ipcMessages = []
            ipcMain.on("MAIN", (_event, message: any, listenerId?: string) => {
                if (["PDF_TO_IMAGE", "PDF_RENDER_OPEN", "PDF_RENDER_PAGE", "PDF_RENDER_CLOSE"].includes(message?.channel)) {
                    state.ipcMessages.push({
                        channel: message.channel,
                        kind: message.ipcRequest?.kind,
                        status: message.ipcRequest?.status,
                        pngType: message.data?.png ? Object.prototype.toString.call(message.data.png) : "",
                        pngBytes: message.data?.png?.byteLength || 0,
                        width: message.data?.width,
                        height: message.data?.height,
                        listenerId
                    })
                }
            })
        })

        const sendPdfImport = (pdfPath: string) =>
            electronApp!.evaluate(({ BrowserWindow }, pdfPath) => {
                const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("index.html"))
                window?.webContents.send("MAIN", { channel: "IMPORT2", data: { channel: "pdf", data: [pdfPath] } })
            }, pdfPath)

        await sendPdfImport(fixturePath)
        await mainWindow.waitForFunction(() => (window as any).__observedImageShows?.length > 0, { timeout: 30_000 })

        const imageShow = await mainWindow.evaluate(() => (window as any).__observedImageShows[0])
        expect(imageShow.source.kind).toBe("pdf")
        expect(imageShow.source.format).toBe("png")
        expect(imageShow.source.pagePaths).toHaveLength(2)
        expect(path.isAbsolute(imageShow.source.sourcePath)).toBe(false)
        expect(path.isAbsolute(imageShow.source.pdfPath)).toBe(false)
        expect(imageShow.images).toHaveLength(2)
        expect(imageShow.images.every((filePath: string) => existsSync(filePath))).toBe(true)

        const manifestPath = path.join(dataFolder.name, path.dirname(imageShow.source.pagePaths[0]), "manifest.json")
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
        expect(manifest.source.cacheKey).toBe(imageShow.source.cacheKey)
        expect(manifest.source.sourceHash).toBe(imageShow.source.sourceHash)

        const rendererReplies = await electronApp.evaluate(() => (globalThis as any).__powerpointImportTest.ipcMessages)
        const renderReplies = rendererReplies.filter((message: any) => message.kind === "reply" && message.status === "success")
        expect(renderReplies.some((message: any) => message.channel === "PDF_RENDER_OPEN")).toBe(true)
        expect(renderReplies.filter((message: any) => message.channel === "PDF_RENDER_PAGE")).toHaveLength(2)
        expect(renderReplies.filter((message: any) => message.channel === "PDF_RENDER_PAGE").every((message: any) => message.pngType === "[object ArrayBuffer]" && message.pngBytes > 1000 && message.width <= 1920 && message.height <= 1080)).toBe(true)
        expect(renderReplies.some((message: any) => message.channel === "PDF_RENDER_CLOSE")).toBe(true)

        const completedCloseCount = await electronApp.evaluate(() => (globalThis as any).__powerpointImportTest.ipcMessages.filter(({ channel, kind, status }: any) => channel === "PDF_RENDER_CLOSE" && kind === "reply" && status === "success").length)
        await electronApp.evaluate(() => {
            ;(globalThis as any).__powerpointImportTest.holdPageRequest = true
        })
        await mainWindow.evaluate(() => {
            ;(window as any).__observedPdfProgress = []
        })
        await sendPdfImport(cancelFixturePath)
        await expect.poll(async () => mainWindow.evaluate(() => (window as any).__observedPdfProgress?.some((item: any) => item.status === "importing"))).toBe(true)
        await expect(mainWindow.locator('button[data-title="actions.cancel"]')).toBeVisible({ timeout: 15_000 })
        await mainWindow.setViewportSize({ width: 390, height: 844 })
        await mainWindow.screenshot({ path: "/tmp/freeshow-ppt-progress-mobile.png" })
        await mainWindow.locator('button[data-title="actions.cancel"]').click()
        await expect.poll(async () => electronApp?.evaluate(() => (globalThis as any).__powerpointImportTest.ipcMessages.some(({ channel, kind }: any) => channel === "PDF_TO_IMAGE" && kind === "cancel"))).toBe(true)
        await expect.poll(async () => mainWindow.evaluate(() => (window as any).__observedPdfProgress?.some((item: any) => item.status === "error"))).toBe(true)
        await expect.poll(async () => electronApp?.evaluate(() => (globalThis as any).__powerpointImportTest.ipcMessages.filter(({ channel, kind, status }: any) => channel === "PDF_RENDER_CLOSE" && kind === "reply" && status === "success").length)).toBeGreaterThan(completedCloseCount)
        await delay(2_200)

        await electronApp.evaluate(({ dialog }, pdfPath) => {
            dialog.showOpenDialogSync = () => [pdfPath]
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdfPath] })
        }, fixturePath)
        await openImport()
        await mainWindow.getByText("PDF", { exact: true }).last().click()
        await expect.poll(async () => electronApp?.evaluate(() => (globalThis as any).__powerpointImportTest.ipcMessages.filter(({ channel, kind }: any) => channel === "PDF_TO_IMAGE" && kind === "request").length)).toBe(3)
        await mainWindow.waitForFunction(() => (window as any).__observedImageShows?.length > 1, { timeout: 30_000 })
        const reimportedShow = await mainWindow.evaluate(() => (window as any).__observedImageShows[1])
        expect(reimportedShow.source.kind).toBe("pdf")
        expect(reimportedShow.source.sourcePath).not.toBe(imageShow.source.sourcePath)
        expect(reimportedShow.images).toHaveLength(2)
        expect(reimportedShow.images.every((filePath: string) => existsSync(filePath))).toBe(true)
    } catch (error) {
        if (electronApp) {
            const trace = await electronApp
                .evaluate(({ ipcMain }) => {
                    const state = (globalThis as any).__powerpointImportTest
                    return {
                        calls: state?.calls?.map(({ message }: any) => ({ channel: message.channel, dataChannel: message.data?.channel, mode: message.data?.mode, kind: message.ipcRequest?.kind })),
                        ipcMessages: state?.ipcMessages,
                        initialListenerCount: state?.initialListenerCount,
                        listenerCountAfterRestore: state?.listenerCountAfterRestore,
                        currentListeners: ipcMain.listeners("MAIN").map((listener) => listener.toString().slice(0, 140))
                    }
                })
                .catch((error) => ({ traceError: String(error) }))
            console.error("PowerPoint import IPC trace:", JSON.stringify(trace))
            const window = electronApp.windows().find((candidate) => candidate.url().includes("index.html"))
            if (window) {
                const frontendState = await window
                    .evaluate(() => ({
                        progress: (window as any).__observedPdfProgress,
                        imageShows: (window as any).__observedImageShows?.length,
                        listeners: window.api.getListeners()
                    }))
                    .catch((error) => ({ traceError: String(error) }))
                console.error("PowerPoint import frontend trace:", JSON.stringify(frontendState))
                console.error((await window.locator("body").innerText()).slice(0, 2000))
                await window.screenshot({ path: "/tmp/freeshow-ppt-import-failure.png" }).catch(() => undefined)
            }
        }
        throw error
    } finally {
        if (electronApp) {
            const process = electronApp.process()
            await Promise.race([electronApp.close(), delay(5_000)]).catch(() => undefined)
            if (process?.pid && !process.killed) process.kill("SIGKILL")
        }
        dataFolder.removeCallback()
        settingFolder.removeCallback()
        if (changedIndex) writeFileSync(indexPath, originalIndex)
    }
})
