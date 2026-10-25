import path from "node:path"
import { createServer as createViteServer, type ViteDevServer } from "vite"
import { Server as SocketServer } from "socket.io"
import { chromium, expect, test, type Browser, type Page } from "@playwright/test"
import { getOutputLineWindow, getRevealLineWindow } from "../../src/common/outputLineWindows"

const projectRoot = process.cwd()
const remotePort = 4331
const controllerPort = 4332
const thumbnail = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1cAAAAASUVORK5CYII="
const backgroundThumbnail = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"><rect width="1024" height="768" fill="#101010"/><path d="M0 0h1024v768H0z" fill="none" stroke="#ffb347" stroke-width="24"/></svg>')}`

type RuntimeServer = { close: () => Promise<void> }
let browser: Browser
const runningServers: RuntimeServer[] = []
const remoteMessages: any[] = []
const controllerMessages: any[] = []
let presenterMode: "normal" | "zero" | "unlimited" = "normal"

function fixtureShow() {
    const notes = `<p>First line<br>Second line</p><img src="http://127.0.0.1:${remotePort}/note-beacon" onerror="window.notesPwned=true"><script>window.notesPwned=true</script><iframe src="http://127.0.0.1:${remotePort}/note-frame"></iframe>`
    return {
        id: "fixture-show",
        name: "Fixture show",
        settings: { activeLayout: "default" },
        slides: {
            current: { id: "current", group: "", color: null, settings: {}, notes, items: [] },
            next: { id: "next", group: "", color: null, settings: {}, notes: "", items: [] }
        },
        layouts: { default: { name: "", notes: "", slides: [{ id: "current" }, { id: "next" }] } },
        media: {}
    }
}

function controllerPreview(showName: string, index: number, mediaPath: string, assetId: string, playback: any) {
    const mediaKey = `media-${index}`
    const backgroundKey = `background-${index}`
    const lines = (values: string[]) => values.map((value) => ({ align: "", text: [{ value, style: "font-size:72px;color:#fff;" }] }))
    return {
        showId: "fixture-show",
        showName,
        layoutId: "default",
        index,
        slide: {
            id: "shared-slide",
            group: "",
            color: null,
            settings: { resolution: { width: 1024, height: 768 } },
            notes: "",
            items: [
                {
                    id: "title",
                    style: "left:80px;top:70px;width:864px;height:280px;",
                    align: "justify-content:center;",
                    lines: lines(["Page one alpha", "Page one beta", "Current slide text", "Page two final"])
                },
                {
                    id: "click-reveal",
                    clickReveal: true,
                    style: "left:80px;top:360px;width:864px;height:160px;",
                    lines: lines(["Click page one alpha", "Click page one beta", "Click page two alpha", "Click page two beta"])
                },
                {
                    id: "line-reveal",
                    lineReveal: true,
                    style: "left:80px;top:530px;width:600px;height:210px;",
                    lines: lines(["Reveal page one alpha", "Reveal page one beta", "Reveal page two alpha", "Reveal page two beta"])
                },
                {
                    id: `media-${index}`,
                    type: "media",
                    src: mediaKey,
                    style: "left:700px;top:560px;width:220px;height:160px;",
                    fit: "cover"
                }
            ]
        },
        layoutSlide: { id: "shared-slide", type: "parent", layoutId: "default", index: 0, layoutIndex: 0, data: { id: "shared-slide", background: backgroundKey } },
        media: {
            [mediaKey]: { path: mediaPath, type: "image" },
            [backgroundKey]: { path: `/fixture/background-${index}.png`, type: "image", fit: "contain" }
        },
        assets: { [mediaPath]: assetId, [`/fixture/background-${index}.png`]: `background-image-${index}` },
        playback
    }
}

function presenterState() {
    const currentPlayback = presenterMode === "zero" ? { line: 0, revealCount: 0, itemClickReveal: true, styleLines: 2 } : presenterMode === "unlimited" ? { line: 0, revealCount: 3, itemClickReveal: true, styleLines: 0 } : { line: 0, revealCount: 3, itemClickReveal: true, styleLines: 2 }

    return {
        revision: 1,
        outputId: "output-1",
        status: "slide",
        showId: "fixture-show",
        showName: "Sunday service",
        layoutId: "default",
        current: controllerPreview("Sunday service", 0, "/fixture/current.png", "current-image", currentPlayback),
        next: controllerPreview("Sunday service", 1, "/fixture/next.png", "next-image", { line: 2, revealCount: 1, itemClickReveal: false, styleLines: 2 }),
        notes: `<p>First line<br>Second line</p><img src="http://127.0.0.1:${controllerPort}/note-beacon" onerror="window.notesPwned=true"><script>window.notesPwned=true</script><iframe src="http://127.0.0.1:${controllerPort}/note-frame"></iframe>`,
        atEnd: false
    }
}

async function startServer(serverId: "remote" | "controller", port: number): Promise<RuntimeServer> {
    process.env.VITE_SERVER_ID = serverId
    process.env.NODE_ENV = "development"

    const vite = (await createViteServer({
        configFile: path.join(projectRoot, "config/building/vite.config.servers.mjs"),
        server: { host: "127.0.0.1", port, strictPort: true }
    })) as ViteDevServer
    await vite.listen()

    const sockets = new SocketServer(vite.httpServer!, { serveClient: false })
    sockets.on("connection", (socket) => {
        if (serverId === "remote") {
            socket.on("REMOTE", (message) => {
                remoteMessages.push(message)
                if (message?.channel === "ACCESS") socket.emit("REMOTE", { channel: "ACCESS", data: null })
                if (message?.channel === "API:get_output") {
                    socket.emit("REMOTE", { channel: "OUT", data: { id: "fixture-show", slide: 0, layout: "default", show: fixtureShow() } })
                    socket.emit("REMOTE", { channel: "OUT_DATA", data: { overlays: [] } })
                }
                if (message?.channel === "API:get_cleared") {
                    socket.emit("REMOTE", { channel: "API:get_cleared", data: { all: false, background: true, slide: false, overlays: true, audio: true, slideTimers: true } })
                }
                if (message?.channel === "MEDIA_LIST") {
                    const { requestId, path: requestedPath, page } = message.data
                    const response = { requestId, path: requestedPath, parentPath: requestedPath ? "" : "", page }
                    if (!requestedPath) {
                        socket.emit("REMOTE", {
                            channel: "MEDIA_PAGE",
                            data: { ...response, items: [{ path: "/fixture", name: "Fixture media", kind: "folder", size: 0, modifiedAt: 1 }], nextCursor: null, hasMore: false }
                        })
                    } else if (page === 0) {
                        socket.emit("REMOTE", {
                            channel: "MEDIA_PAGE",
                            data: {
                                ...response,
                                parentPath: "",
                                items: [
                                    { path: "/fixture/poster.png", name: "poster.png", kind: "image", size: 1200, modifiedAt: 1 },
                                    { path: "/fixture/clip.mp4", name: "clip.mp4", kind: "video", size: 2400, modifiedAt: 1 },
                                    { path: "/fixture/song.mp3", name: "song.mp3", kind: "audio", size: 3600, modifiedAt: 1 }
                                ],
                                nextCursor: "fixture-page-1",
                                hasMore: true
                            }
                        })
                    } else if (page === 1) {
                        socket.emit("REMOTE", {
                            channel: "MEDIA_PAGE",
                            data: { ...response, parentPath: "", items: [], nextCursor: "fixture-page-2", hasMore: true }
                        })
                    } else {
                        socket.emit("REMOTE", {
                            channel: "MEDIA_PAGE",
                            data: { ...response, parentPath: "", items: [{ path: "/fixture/last.jpg", name: "last.jpg", kind: "image", size: 800, modifiedAt: 1 }], nextCursor: null, hasMore: false }
                        })
                    }
                }
                if (message?.channel === "MEDIA_THUMBNAIL") {
                    socket.emit("REMOTE", { channel: "MEDIA_THUMBNAIL_RESULT", data: { requestId: message.data.requestId, path: message.data.path, thumbnail } })
                }
                if (message?.channel === "MEDIA_PLAY") {
                    socket.emit("REMOTE", { channel: "MEDIA_PLAY_RESULT", data: { requestId: message.data.requestId, ok: true } })
                }
            })
        } else {
            socket.on("CONTROLLER", (message) => {
                controllerMessages.push(message)
                if (message?.channel === "GET_OUTPUT_ID") socket.emit("CONTROLLER", { channel: "GET_OUTPUT_ID", data: "output-1" })
                if (message?.channel === "PRESENTER_SUBSCRIBE") socket.emit("CONTROLLER", { channel: "PRESENTER_STATE", data: presenterState() })
                if (message?.channel === "PRESENTER_THUMBNAIL") {
                    socket.emit("CONTROLLER", {
                        channel: "PRESENTER_THUMBNAIL_RESULT",
                        data: {
                            revision: message.data.revision,
                            assetId: message.data.assetId,
                            thumbnail: message.data.assetId.startsWith("background-") ? backgroundThumbnail : thumbnail
                        }
                    })
                }
            })
        }
    })

    return {
        close: async () => {
            await sockets.close()
            await vite.close()
        }
    }
}

test.beforeAll(async () => {
    browser = await chromium.launch()
    runningServers.push(await startServer("remote", remotePort))
    runningServers.push(await startServer("controller", controllerPort))
})

test.afterAll(async () => {
    for (const server of runningServers.reverse()) await server.close()
    await browser?.close()
})

test("remote media browsing and controller previews work through a fixture Socket.IO server", async () => {
    expect(getRevealLineWindow(0, 2)).toEqual({ start: 0, end: 0 })
    expect(getRevealLineWindow(3, 0)).toEqual({ start: 0, end: 3 })
    expect(getOutputLineWindow({ line: 1, maxLines: 5, styleLines: 0, amountOfLinesToShow: 1, highestLinePos: 0 })).toEqual({ start: null, end: null })

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const phoneBeacons: string[] = []
    phone.on("request", (request) => {
        if (request.url().includes("note-beacon") || request.url().includes("note-frame")) phoneBeacons.push(request.url())
    })
    await phone.addInitScript(() => {
        localStorage.setItem("password", "fixture")
        ;(window as any).notesPwned = false
    })
    await phone.goto(`http://127.0.0.1:${remotePort}`)
    await expect(phone.locator(".tabs button[title='Media']")).toBeVisible()

    const phoneSlideTab = phone.locator(".tabs button[title='Slide']")
    await expect(phoneSlideTab).toBeVisible()
    await expect(phone.locator(".notes p")).toContainText("First line")
    expect(await phone.locator(".notes p").innerText()).toContain("Second line")
    expect(await phone.evaluate(() => (window as any).notesPwned)).toBe(false)
    expect(phoneBeacons).toEqual([])

    await phone.locator(".tabs button[title='Media']").click()
    await expect(phone.locator(".media-library")).toBeVisible()
    await phone.locator(".media-entry").filter({ hasText: "Fixture media" }).click()
    await expect(phone.locator(".media-entry").filter({ hasText: "poster.png" })).toBeVisible()
    await expect(phone.locator(".media-entry img").first()).toHaveAttribute("src", /^data:image\/png;base64,/)
    await phone.screenshot({ path: "/tmp/remote-media-phone.png", fullPage: true })

    await phone.locator(".media-entry").filter({ hasText: "poster.png" }).click()
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_PLAY" && message.data?.path === "/fixture/poster.png")).toBe(true)
    await phone.locator(".media-entry").filter({ hasText: "clip.mp4" }).click()
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_PLAY" && message.data?.path === "/fixture/clip.mp4")).toBe(true)
    await phone.locator(".media-entry").filter({ hasText: "song.mp3" }).click()
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_PLAY" && message.data?.path === "/fixture/song.mp3")).toBe(true)

    await phone.getByRole("button", { name: /Next/ }).click()
    await expect(phone.locator(".empty-state")).toContainText("Continue to scan the folder")
    await expect(phone.getByRole("button", { name: /Next/ })).toBeEnabled()
    await phone.getByRole("button", { name: /Next/ }).click()
    await expect(phone.locator(".media-entry").filter({ hasText: "last.jpg" })).toBeVisible()
    await phone.locator(".tabs button[title='Slide']").click()
    await expect(phone.locator(".notes p")).toContainText("Second line")
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_CANCEL")).toBe(true)
    await phone.close()

    const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 } })
    await tablet.addInitScript(() => localStorage.setItem("password", "fixture"))
    await tablet.goto(`http://127.0.0.1:${remotePort}`)
    await expect(tablet.locator(".tabletMode")).toBeVisible()
    await tablet.locator(".drawer .tabs button").filter({ hasText: "Media" }).click()
    await expect(tablet.locator(".media-library")).toBeVisible()
    await expect(tablet.locator(".media-entry").filter({ hasText: "Fixture media" })).toBeVisible()
    await tablet.screenshot({ path: "/tmp/remote-media-tablet.png", fullPage: true })
    await tablet.close()

    const controller = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const controllerBeacons: string[] = []
    controller.on("request", (request) => {
        if (request.url().includes("note-beacon") || request.url().includes("note-frame")) controllerBeacons.push(request.url())
    })
    await controller.addInitScript(() => {
        ;(window as any).notesPwned = false
    })
    await controller.goto(`http://127.0.0.1:${controllerPort}`)
    await expect(controller.locator(".preview-heading").first()).toContainText("Current")
    await expect(controller.locator(".preview-heading").nth(1)).toContainText("Next")
    await expect(controller.locator(".preview-panel").first()).toContainText("Page one alpha")
    await expect(controller.locator(".preview-panel").first()).toContainText("Reveal page one beta")
    await expect(controller.locator(".preview-panel").first()).toContainText("Reveal page two alpha")
    await expect(controller.locator(".preview-panel").first()).not.toContainText("Reveal page one alpha")
    await expect(controller.locator(".preview-panel").first()).not.toContainText("Reveal page two beta")
    await expect(controller.locator(".preview-panel").first()).toContainText("Click page one alpha")
    await expect(controller.locator(".preview-panel").first()).not.toContainText("Click page two alpha")
    await expect(controller.locator(".preview-panel").nth(1)).toContainText("Current slide text")
    await expect(controller.locator(".preview-panel").nth(1)).toContainText("Page two final")
    await expect(controller.locator(".preview-panel").nth(1)).not.toContainText("Page one alpha")
    await expect(controller.locator(".preview-panel").nth(1)).toContainText("Reveal page one alpha")
    await expect(controller.locator(".preview-panel").nth(1)).not.toContainText("Reveal page one beta")
    await expect(controller.locator(".preview-panel").nth(1)).not.toContainText("Click page one alpha")
    await expect.poll(() => controllerMessages.filter((message) => message?.channel === "PRESENTER_THUMBNAIL").length).toBeGreaterThan(0)
    await expect(controller.locator(".preview-panel .item img").first()).toHaveAttribute("src", /^data:image\/png;base64,/)
    const currentBackground = controller.locator(".preview-panel .background-image").first()
    await expect(currentBackground).toHaveAttribute("style", /width:1024px;height:768px/)
    await expect(controller.locator(".preview-panel .item img").first()).toHaveCSS("object-fit", "cover")
    const backgroundBounds = await currentBackground.boundingBox()
    const slideBounds = await controller.locator(".preview-panel .slide").first().boundingBox()
    expect(backgroundBounds).not.toBeNull()
    expect(slideBounds).not.toBeNull()
    expect(Math.abs(backgroundBounds!.width - slideBounds!.width)).toBeLessThan(1)
    expect(Math.abs(backgroundBounds!.height - slideBounds!.height)).toBeLessThan(1)
    const controllerNotes = await controller.locator(".presenter-notes p").innerText()
    expect(controllerNotes).toMatch(/First line\s+Second line/)
    expect(controllerNotes).not.toContain("window.notesPwned")
    expect(await controller.evaluate(() => (window as any).notesPwned)).toBe(false)
    expect(controllerBeacons).toEqual([])
    await controller.getByRole("button", { name: "Next slide" }).click()
    await expect.poll(() => controllerMessages.some((message) => message?.channel === "ACTION" && message.data?.id === "next")).toBe(true)
    await controller.getByRole("button", { name: "Previous slide" }).click()
    await expect.poll(() => controllerMessages.some((message) => message?.channel === "ACTION" && message.data?.id === "previous")).toBe(true)
    await controller.getByRole("button", { name: "Clear output" }).click()
    await expect.poll(() => controllerMessages.some((message) => message?.channel === "ACTION" && message.data?.id === "clear")).toBe(true)
    await controller.setViewportSize({ width: 1440, height: 900 })
    await controller.close()

    presenterMode = "zero"
    const zeroReveal = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await zeroReveal.goto(`http://127.0.0.1:${controllerPort}`)
    await expect(zeroReveal.locator(".preview-panel").first()).toContainText("Page one alpha")
    await expect(zeroReveal.locator(".preview-panel").first().locator(".item").nth(2).locator(".break")).toHaveCount(0)
    await zeroReveal.close()

    presenterMode = "unlimited"
    const unlimitedReveal = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await unlimitedReveal.goto(`http://127.0.0.1:${controllerPort}`)
    await expect(unlimitedReveal.locator(".preview-panel").first().locator(".item").nth(2).locator(".break")).toHaveCount(3)
    await expect(unlimitedReveal.locator(".preview-panel").first().locator(".item").nth(2)).not.toContainText("Reveal page two beta")
    await unlimitedReveal.close()
    presenterMode = "normal"
})
