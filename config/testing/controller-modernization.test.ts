import path from "node:path"
import { createServer as createViteServer, type ViteDevServer } from "vite"
import { Server as SocketServer } from "socket.io"
import { chromium, expect, test, type Browser, type Page } from "@playwright/test"

const projectRoot = process.cwd()
const controllerPort = 4333
const currentSocketMessages: any[] = []
const fixtureOutputSize = { width: 1024, height: 768 }
type RuntimeServer = {
    close: () => Promise<void>
    setMode: (mode: "normal" | "end" | "cleared" | "restart", revision?: number) => void
    sendThumbnail: (revision: number, assetId: string) => void
    holdPresenterState: () => void
    releasePresenterState: () => void
}
let browser: Browser
let controllerServer: RuntimeServer

function preview(index: number, title: string, lyric: string, revision: number) {
    const backgroundKey = revision >= 100 ? `/fixture/background-${revision}-${index}.png` : ""
    const lines = [title, lyric].map((value) => ({ align: "", text: [{ value, style: "font-size:68px;color:#f4f1ed;" }] }))
    return {
        showName: "Sunday service",
        index,
        slide: {
            id: `slide-${index}`,
            color: null,
            settings: { resolution: { width: 1024, height: 768 }, color: "#211e1b" },
            items: [
                {
                    id: `title-${index}`,
                    style: "left:70px;top:180px;width:884px;height:360px;",
                    align: "justify-content:center;",
                    lines
                }
            ]
        },
        layoutSlide: { id: `slide-${index}`, type: "parent", layoutId: "default", index, layoutIndex: 0, data: backgroundKey ? { background: backgroundKey } : {} },
        media: {},
        assets: backgroundKey ? { [backgroundKey]: `asset-${revision}-${index}` } : {}
    }
}

function makePresenterState(mode: "normal" | "end" | "cleared" | "restart", revision: number) {
    const cleared = mode === "cleared"
    const currentTitle = revision >= 100 ? "High revision before reconnect" : mode === "restart" ? "Fresh slide after restart" : "Blessed assurance, Jesus is mine"
    return {
        revision,
        outputId: "fixture-output",
        status: cleared ? "cleared" : "slide",
        showName: "Sunday service",
        current: cleared ? null : preview(0, currentTitle, "O what a foretaste of glory divine", revision),
        next: cleared || mode === "end" ? null : preview(1, "Heir of salvation, purchase of God", "Born of His Spirit, washed in His blood", revision),
        notes: cleared ? "" : "Opening verse\nCongregation joins on the refrain.\nKeep the final line on screen for the response.",
        atEnd: mode === "end"
    }
}

async function startControllerServer(port: number): Promise<RuntimeServer> {
    process.env.VITE_SERVER_ID = "controller"
    process.env.NODE_ENV = "development"

    const vite = (await createViteServer({
        configFile: path.join(projectRoot, "config/building/vite.config.servers.mjs"),
        server: { host: "127.0.0.1", port, strictPort: true }
    })) as ViteDevServer
    await vite.listen()

    const sockets = new SocketServer(vite.httpServer!, { serveClient: false, pingInterval: 500, pingTimeout: 500 })
    currentSocketMessages.length = 0
    let mode: "normal" | "end" | "cleared" | "restart" = "normal"
    let revision = 1
    let holdPresenterState = false
    const heldPresenterStateSends: Array<() => void> = []

    function sendPresenterState(socket: any, data: ReturnType<typeof makePresenterState>) {
        const send = () => socket.connected && socket.emit("CONTROLLER", { channel: "PRESENTER_STATE", data })
        if (holdPresenterState) heldPresenterStateSends.push(send)
        else send()
    }

    sockets.on("connection", (socket) => {
        socket.on("CONTROLLER", (message) => {
            currentSocketMessages.push(message)
            if (message?.channel === "GET_OUTPUT_ID") socket.emit("CONTROLLER", { channel: "GET_OUTPUT_ID", data: "fixture-output" })
            if (message?.channel === "PRESENTER_SUBSCRIBE") {
                const data = makePresenterState(mode, revision)
                sendPresenterState(socket, data)
            }
            if (message?.channel === "PRESENTER_THUMBNAIL") {
                if (message.data.revision >= 100) return
                socket.emit("CONTROLLER", {
                    channel: "PRESENTER_THUMBNAIL_RESULT",
                    data: { revision: message.data.revision, assetId: message.data.assetId, thumbnail: "" }
                })
            }
            if (message?.channel === "OUTPUT_FRAME" && message.data?.outputId === "fixture-output") {
                socket.emit("CONTROLLER", {
                    channel: "OUTPUT_FRAME",
                    data: {
                        outputId: "fixture-output",
                        width: fixtureOutputSize.width,
                        height: fixtureOutputSize.height,
                        frame: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${fixtureOutputSize.width}" height="${fixtureOutputSize.height}"><rect width="${fixtureOutputSize.width}" height="${fixtureOutputSize.height}" fill="#211e1b"/><text x="512" y="330" fill="#f4f1ed" font-family="sans-serif" font-size="56" text-anchor="middle">Blessed assurance, Jesus is mine</text><text x="512" y="410" fill="#f4f1ed" font-family="sans-serif" font-size="44" text-anchor="middle">O what a foretaste of glory divine</text></svg>`)}`
                    }
                })
            }
        })
    })

    return {
        close: async () => {
            await sockets.close()
            await vite.close()
        },
        setMode: (nextMode, nextRevision) => {
            mode = nextMode
            revision = nextRevision ?? revision + 1
            for (const socket of sockets.sockets.sockets.values()) {
                sendPresenterState(socket, makePresenterState(mode, revision))
            }
        },
        sendThumbnail: (thumbnailRevision, assetId) => {
            for (const socket of sockets.sockets.sockets.values()) {
                socket.emit("CONTROLLER", {
                    channel: "PRESENTER_THUMBNAIL_RESULT",
                    data: { revision: thumbnailRevision, assetId, thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%23faa739'/%3E%3C/svg%3E" }
                })
            }
        },
        holdPresenterState: () => {
            holdPresenterState = true
        },
        releasePresenterState: () => {
            holdPresenterState = false
            for (const send of heldPresenterStateSends.splice(0)) send()
        }
    }
}

test.beforeAll(async () => {
    browser = await chromium.launch()
    controllerServer = await startControllerServer(controllerPort)
})

test.afterAll(async () => {
    await controllerServer?.close()
    await browser?.close()
})

async function blurActiveElement(page: Page) {
    await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
}

test("controller keeps previews and actions usable across phone, desktop, draw, and reconnect states", async ({}, testInfo) => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await page.goto(`http://127.0.0.1:${controllerPort}`)
    await expect(page.getByRole("status")).toHaveText("Connected")
    await expect(page.getByRole("heading", { name: "Current" })).toBeVisible()
    await expect(page.locator(".preview-panel").first()).toContainText("Blessed assurance, Jesus is mine")
    await expect(page.locator(".preview-panel").nth(1)).toContainText("Heir of salvation, purchase of God")
    await expect(page.getByRole("region", { name: "Notes" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Notes" })).toContainText("Congregation joins on the refrain")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)

    const actionBounds = await page.locator(".action-row button").evaluateAll((buttons) =>
        buttons.map((button) => {
            const rect = button.getBoundingClientRect()
            return { width: rect.width, height: rect.height, left: rect.left, right: rect.right }
        })
    )
    expect(actionBounds).toHaveLength(3)
    for (const bounds of actionBounds) expect(bounds.height).toBeGreaterThanOrEqual(44)
    for (let index = 1; index < actionBounds.length; index++) expect(actionBounds[index].left - actionBounds[index - 1].right).toBeGreaterThanOrEqual(8)
    await page.screenshot({ path: testInfo.outputPath("controller-modern-phone.png") })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: testInfo.outputPath("controller-modern-desktop.png") })
    await page.setViewportSize({ width: 1280, height: 560 })
    await page.screenshot({ path: testInfo.outputPath("controller-modern-landscape.png") })
    await page.setViewportSize({ width: 844, height: 390 })
    await page.locator(".workspace").evaluate((workspace) => (workspace.scrollTop = 0))
    const landscapeNotesVisible = await page.evaluate(() => {
        const workspace = document.querySelector(".workspace")
        const notes = document.querySelector(".presenter-notes")
        const paragraph = notes?.querySelector("p")
        if (!workspace || !notes || !paragraph) return false
        const workspaceBounds = workspace.getBoundingClientRect()
        const headingBounds = notes.querySelector("h2")!.getBoundingClientRect()
        const paragraphRange = document.createRange()
        paragraphRange.selectNodeContents(paragraph)
        const paragraphLines = Array.from(paragraphRange.getClientRects())
        return workspace.scrollTop === 0 && headingBounds.top >= workspaceBounds.top && headingBounds.bottom <= workspaceBounds.bottom && paragraphLines.length >= 2 && paragraphLines[0].top >= workspaceBounds.top && paragraphLines[1].bottom <= workspaceBounds.bottom
    })
    expect(landscapeNotesVisible).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("controller-modern-phone-landscape.png") })
    const drawModeButton = page.getByRole("button", { name: "Draw mode" })
    await drawModeButton.click()
    await expect(drawModeButton).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("region", { name: "Drawing tools" })).toBeVisible()
    await page.locator("#drawing-tool").selectOption("Paint")
    await expect(page.getByRole("button", { name: "Clear drawing" })).toBeVisible()
    const landscapeDrawSurface = page.locator(".draw-surface")
    await landscapeDrawSurface.scrollIntoViewIfNeeded()
    await expect(landscapeDrawSurface.locator("img")).toBeVisible({ timeout: 3000 })
    const frameSize = await landscapeDrawSurface.locator("img").evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))
    expect(frameSize).toEqual(fixtureOutputSize)
    const canvasBounds = await landscapeDrawSurface.boundingBox()
    expect(canvasBounds).not.toBeNull()
    if (!canvasBounds) throw new Error("Drawing surface is missing its bounds")
    expect(canvasBounds.width / canvasBounds.height).toBeCloseTo(frameSize.width / frameSize.height, 2)
    const pointerTarget = { x: canvasBounds.x + canvasBounds.width * 0.25, y: canvasBounds.y + canvasBounds.height * 0.5 }
    await landscapeDrawSurface.dispatchEvent("pointerdown", { button: 0, clientX: pointerTarget.x, clientY: pointerTarget.y })
    await landscapeDrawSurface.dispatchEvent("pointermove", { clientX: pointerTarget.x, clientY: pointerTarget.y })
    await landscapeDrawSurface.dispatchEvent("pointerup", { button: 0, clientX: pointerTarget.x, clientY: pointerTarget.y })
    const mappedPointer = currentSocketMessages.filter((message) => message?.channel === "FOCUS" && message.data?.offset?.x !== undefined).pop()?.data?.offset
    expect(mappedPointer.x).toBeCloseTo(0.25, 2)
    expect(mappedPointer.y).toBeCloseTo(0.5, 2)
    await page.screenshot({ path: testInfo.outputPath("controller-modern-phone-landscape-draw.png") })
    await page.getByRole("button", { name: "Show controls" }).click()
    await expect(page.getByRole("button", { name: "Show controls" })).toHaveAttribute("aria-pressed", "true")
    await page.setViewportSize({ width: 390, height: 844 })

    controllerServer.setMode("end")
    await expect(page.locator(".preview-panel").nth(1)).toContainText("End of show")
    const actionCountBeforeNext = currentSocketMessages.filter((message) => message?.channel === "ACTION").length
    await page.getByRole("button", { name: "Next", exact: true }).click()
    await expect.poll(() => currentSocketMessages.filter((message) => message?.channel === "ACTION").length).toBe(actionCountBeforeNext + 1)
    expect(currentSocketMessages.filter((message) => message?.channel === "ACTION").pop()?.data?.id).toBe("next")

    await page.getByRole("button", { name: "Draw mode" }).click()
    await expect(page.getByRole("region", { name: "Drawing tools" })).toBeVisible()
    await page.locator("#drawing-tool").selectOption("Paint")
    await page.getByRole("button", { name: "Clear drawing" }).click()
    await expect.poll(() => currentSocketMessages.some((message) => message?.channel === "ACTION" && message.data?.id === "clear_painting")).toBe(true)
    const drawSurface = page.locator(".draw-surface")
    await drawSurface.dispatchEvent("pointerdown", { button: 0, clientX: 40, clientY: 40 })
    await drawSurface.dispatchEvent("pointermove", { clientX: 80, clientY: 80 })
    await drawSurface.dispatchEvent("pointerup", { button: 0, clientX: 80, clientY: 80 })
    await expect.poll(() => currentSocketMessages.some((message) => message?.channel === "FOCUS" && message.data?.offset?.x !== undefined)).toBe(true)

    await page.getByRole("button", { name: "Clear output" }).click()
    await expect.poll(() => currentSocketMessages.some((message) => message?.channel === "ACTION" && message.data?.id === "clear")).toBe(true)

    const actionCountBeforeFocusedSpace = currentSocketMessages.filter((message) => message?.channel === "ACTION").length
    await page.getByRole("button", { name: "Next", exact: true }).focus()
    await page.keyboard.press("Space")
    await expect.poll(() => currentSocketMessages.filter((message) => message?.channel === "ACTION").length).toBe(actionCountBeforeFocusedSpace + 1)
    expect(currentSocketMessages.filter((message) => message?.channel === "ACTION").pop()?.data?.id).toBe("next")

    await page.keyboard.press("PageDown")
    await expect.poll(() => currentSocketMessages.filter((message) => message?.channel === "ACTION").length).toBe(actionCountBeforeFocusedSpace + 2)
    expect(currentSocketMessages.filter((message) => message?.channel === "ACTION").pop()?.data?.id).toBe("next")
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => currentSocketMessages.filter((message) => message?.channel === "ACTION").length).toBe(actionCountBeforeFocusedSpace + 3)
    expect(currentSocketMessages.filter((message) => message?.channel === "ACTION").pop()?.data?.id).toBe("next")

    await page.getByRole("button", { name: "Draw mode" }).focus()
    await page.keyboard.press("Escape")
    await expect.poll(() => currentSocketMessages.filter((message) => message?.channel === "ACTION").length).toBe(actionCountBeforeFocusedSpace + 4)
    expect(currentSocketMessages.filter((message) => message?.channel === "ACTION").pop()?.data?.id).toBe("clear")

    await blurActiveElement(page)
    await page.keyboard.press("ArrowLeft")
    await expect.poll(() => currentSocketMessages.filter((message) => message?.channel === "ACTION").length).toBe(actionCountBeforeNext + 8)

    const actionCountBeforeDisconnect = currentSocketMessages.filter((message) => message?.channel === "ACTION").length
    const focusCountBeforeDisconnect = currentSocketMessages.filter((message) => message?.channel === "FOCUS").length
    controllerServer.setMode("normal", 100)
    await expect(page.locator(".preview-panel").first()).toContainText("High revision before reconnect")
    await expect.poll(() => currentSocketMessages.filter((message) => message?.channel === "PRESENTER_THUMBNAIL" && message.data?.revision === 100).length).toBeGreaterThan(0)
    await page.context().setOffline(true)
    await expect(page.getByRole("status")).toHaveText(/Reconnecting|Disconnected/, { timeout: 5000 })
    await expect(page.locator(".connection-message")).toContainText("out of date")
    expect(await page.getByRole("button", { name: "Next", exact: true }).isDisabled()).toBe(true)
    await blurActiveElement(page)
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("Escape")
    await drawSurface.dispatchEvent("pointerdown", { button: 0, clientX: 40, clientY: 40 })
    await drawSurface.dispatchEvent("pointermove", { clientX: 80, clientY: 80 })
    await drawSurface.dispatchEvent("pointerup", { button: 0, clientX: 80, clientY: 80 })
    controllerServer.holdPresenterState()
    controllerServer.setMode("restart", 1)
    await page.context().setOffline(false)
    await expect(page.getByRole("status")).toHaveText("Connected", { timeout: 10_000 })
    await expect(page.locator(".connection-message")).toContainText("Waiting for fresh slide data")
    await expect(page.locator(".preview-panel").first()).toContainText("High revision before reconnect")
    controllerServer.releasePresenterState()
    await expect(page.locator(".preview-panel").first()).toContainText("Fresh slide after restart")
    expect(currentSocketMessages.filter((message) => message?.channel === "ACTION").length).toBe(actionCountBeforeDisconnect)
    expect(currentSocketMessages.filter((message) => message?.channel === "FOCUS")).toHaveLength(focusCountBeforeDisconnect)
    await expect(page.getByRole("button", { name: "Draw mode" })).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("region", { name: "Drawing tools" })).toBeVisible()
    await drawSurface.dispatchEvent("pointerdown", { button: 0, clientX: 40, clientY: 40 })
    await drawSurface.dispatchEvent("pointermove", { clientX: 80, clientY: 80 })
    await drawSurface.dispatchEvent("pointerup", { button: 0, clientX: 80, clientY: 80 })
    await expect.poll(() => currentSocketMessages.filter((message) => message?.channel === "FOCUS").length).toBeGreaterThan(focusCountBeforeDisconnect)
    controllerServer.sendThumbnail(100, "asset-100-0")
    await page.waitForTimeout(100)
    await expect(page.locator(".preview-panel .background-image")).toHaveCount(0)

    controllerServer.setMode("cleared")
    await expect(page.locator(".preview-panel").first()).toContainText("Output cleared")
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled()
    await page.close()
})
