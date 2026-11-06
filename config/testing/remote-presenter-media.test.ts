import path from "node:path"
import { readFileSync } from "node:fs"
import { createServer as createViteServer, type ViteDevServer } from "vite"
import { Server as SocketServer } from "socket.io"
import { chromium, expect, test, type Browser, type Page } from "@playwright/test"
import { getOutputLineWindow, getRevealLineWindow } from "../../src/common/outputLineWindows"

const projectRoot = process.cwd()
const remotePort = 4331
const controllerPort = 4332
const ccfiiLogo = readFileSync(path.join(process.cwd(), "public/ccfii-logo.png")).toString("base64")
const thumbnail = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#171513"/><image href="data:image/png;base64,${ccfiiLogo}" x="64" y="92" width="210" height="210"/><text x="320" y="235" fill="#f4f1ed" font-family="system-ui, sans-serif" font-size="54" font-weight="600">Sunday service</text><text x="322" y="286" fill="#faa739" font-family="system-ui, sans-serif" font-size="22">Sample fixture preview</text></svg>`)}`
const backgroundThumbnail = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"><rect width="1024" height="768" fill="#101010"/><path d="M0 0h1024v768H0z" fill="none" stroke="#ffb347" stroke-width="24"/></svg>')}`

type RuntimeServer = { close: () => Promise<void> }
let browser: Browser
const runningServers: RuntimeServer[] = []
const remoteMessages: any[] = []
const controllerMessages: any[] = []
const mediaBrowseIds = new Map<string, string>()
const pendingClipListThumbnails = new Map<string, { socket: any; data: any }[]>()
const pendingPageOne = new Map<string, { socket: any; data: any }>()
const clipPreviewThumbnailRequests = new Map<string, number>()
const mediaThumbnailResults: any[] = []
let cancelNextPageOne = false
let audioOutputState: { id: string; paused: boolean; duration: number } | null = null
let audioOutputTime = 63
let fixtureOutputMediaPath = ""
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
                    socket.emit("REMOTE", { channel: "OUT_DATA", data: { overlays: [], ...(fixtureOutputMediaPath ? { background: { path: fixtureOutputMediaPath } } : {}) } })
                }
                if (message?.channel === "API:get_cleared") {
                    socket.emit("REMOTE", { channel: "API:get_cleared", data: { all: false, background: true, slide: false, overlays: true, audio: true, slideTimers: true } })
                }
                if (message?.channel === "API:get_playing_audio_data") {
                    socket.emit("REMOTE", { channel: "API:get_playing_audio_data", data: audioOutputState || {} })
                }
                if (message?.channel === "API:get_playing_audio_time") {
                    socket.emit("REMOTE", { channel: "API:get_playing_audio_time", data: audioOutputTime })
                }
                if (message?.channel === "API:pause_audio" && audioOutputState?.id === message.data?.path) {
                    audioOutputState = { ...audioOutputState, paused: true }
                }
                if (message?.channel === "MEDIA_LIST") {
                    const { requestId, path: requestedPath, page } = message.data
                    const connectionId = message.id || ""
                    if (page === 0) mediaBrowseIds.set(connectionId, requestId)
                    else if (mediaBrowseIds.get(connectionId) !== requestId) {
                        socket.emit("REMOTE", { channel: "MEDIA_ERROR", data: { requestId, code: "cursor_expired" } })
                        return
                    }
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
                        const pageData = { ...response, parentPath: "", items: [], nextCursor: "fixture-page-2", hasMore: true }
                        if (cancelNextPageOne) {
                            cancelNextPageOne = false
                            pendingPageOne.set(connectionId, { socket, data: pageData })
                        } else {
                            // The protocol ID identifies the browse session, so a stale
                            // prior-page reply can share it. It must not consume page 1's
                            // pending operation or replace the current page.
                            socket.emit("REMOTE", { channel: "MEDIA_PAGE", data: { ...pageData, page: 0 } })
                            setTimeout(() => socket.emit("REMOTE", { channel: "MEDIA_PAGE", data: pageData }), 100)
                        }
                    } else {
                        socket.emit("REMOTE", {
                            channel: "MEDIA_PAGE",
                            data: { ...response, parentPath: "", items: [{ path: "/fixture/last.jpg", name: "last.jpg", kind: "image", size: 800, modifiedAt: 1 }], nextCursor: null, hasMore: false }
                        })
                    }
                }
                if (message?.channel === "MEDIA_THUMBNAIL") {
                    if (message.data.path === "/fixture/clip.mp4") {
                        const connectionId = message.id || ""
                        if (mediaBrowseIds.has(connectionId)) {
                            const requests = pendingClipListThumbnails.get(connectionId) || []
                            requests.push({ socket, data: message.data })
                            pendingClipListThumbnails.set(connectionId, requests)
                        } else {
                            const requestCount = (clipPreviewThumbnailRequests.get(connectionId) || 0) + 1
                            clipPreviewThumbnailRequests.set(connectionId, requestCount)
                            if (requestCount === 1) {
                                socket.emit("REMOTE", { channel: "MEDIA_ERROR", data: { requestId: message.data.requestId, code: "thumbnail_busy" } })
                            } else {
                                const result = { requestId: message.data.requestId, path: message.data.path, thumbnail }
                                mediaThumbnailResults.push(result)
                                socket.emit("REMOTE", { channel: "MEDIA_THUMBNAIL_RESULT", data: result })
                            }
                        }
                    } else {
                        const result = { requestId: message.data.requestId, path: message.data.path, thumbnail }
                        mediaThumbnailResults.push(result)
                        socket.emit("REMOTE", { channel: "MEDIA_THUMBNAIL_RESULT", data: result })
                    }
                }
                if (message?.channel === "MEDIA_CANCEL") {
                    const connectionId = message.id || ""
                    if (mediaBrowseIds.get(connectionId) === message.data?.requestId) {
                        mediaBrowseIds.delete(connectionId)
                        for (const request of pendingClipListThumbnails.get(connectionId) || []) {
                            const result = { requestId: request.data.requestId, path: request.data.path, thumbnail }
                            mediaThumbnailResults.push(result)
                            request.socket.emit("REMOTE", { channel: "MEDIA_THUMBNAIL_RESULT", data: result })
                        }
                        pendingClipListThumbnails.delete(connectionId)
                        const stalePage = pendingPageOne.get(connectionId)
                        if (stalePage?.data.requestId === message.data?.requestId) {
                            setTimeout(() => stalePage.socket.emit("REMOTE", { channel: "MEDIA_PAGE", data: stalePage.data }), 1200)
                            pendingPageOne.delete(connectionId)
                        }
                    }
                }
                if (message?.channel === "MEDIA_PLAY") {
                    fixtureOutputMediaPath = message.data.path
                    socket.emit("REMOTE", { channel: "OUT_DATA", data: { overlays: [], background: { path: fixtureOutputMediaPath } } })
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

test("remote media browsing and controller previews work through a fixture Socket.IO server", async ({}, testInfo) => {
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
    await expect(phone.locator(".bottom-tabs button[title='Media']")).toBeVisible()

    const topSearch = phone.locator(".top-search")
    await expect(topSearch).toHaveAccessibleName("Search")
    const topSearchBox = await topSearch.boundingBox()
    expect(topSearchBox!.width).toBeGreaterThanOrEqual(44)
    expect(topSearchBox!.height).toBeGreaterThanOrEqual(44)
    await topSearch.focus()
    await expect(topSearch).toBeFocused()
    await phone.keyboard.press("Enter")
    await expect(phone.locator(".bottom-tabs button[title='Shows']")).toHaveAttribute("aria-current", "page")
    await phone.locator(".bottom-tabs button[title='Control']").click()

    const phoneSlideTab = phone.locator(".bottom-tabs button[title='Control']")
    await expect(phoneSlideTab).toBeVisible()
    await expect(phone.locator(".notes p")).toContainText("First line")
    expect(await phone.locator(".notes p").innerText()).toContain("Second line")
    expect(await phone.evaluate(() => (window as any).notesPwned)).toBe(false)
    expect(phoneBeacons).toEqual([])

    await phone.locator(".bottom-tabs button[title='Media']").click()
    await expect(phone.locator(".media-library")).toBeVisible()
    await phone.locator(".media-entry").filter({ hasText: "Fixture media" }).click()
    await expect(phone.locator(".media-entry").filter({ hasText: "poster.png" })).toBeVisible()
    await expect(phone.locator(".media-entry img").first()).toHaveAttribute("src", /^data:image\/svg\+xml,/)
    await phone.screenshot({ path: testInfo.outputPath("remote-media-phone.png"), fullPage: true })

    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_THUMBNAIL" && message.data?.path === "/fixture/clip.mp4")).toBe(true)
    const clipListRequest = remoteMessages.find((message) => message?.channel === "MEDIA_THUMBNAIL" && message.data?.path === "/fixture/clip.mp4")
    await phone.waitForTimeout(150)
    expect(mediaThumbnailResults.some((result) => result.requestId === clipListRequest.data.requestId)).toBe(false)
    await phone.locator(".media-entry").filter({ hasText: "clip.mp4" }).click()
    await expect(phone.locator(".remote-media-page h2")).toHaveText("clip.mp4")
    await expect(phone.locator(".bottom-tabs button[title='Media']")).toHaveAttribute("aria-current", "page")
    await expect(phone.getByRole("button", { name: "Retry preview" })).toBeVisible()
    await expect.poll(() => mediaThumbnailResults.some((result) => result.requestId === clipListRequest.data.requestId)).toBe(true)
    await phone.getByRole("button", { name: "Retry preview" }).click()
    await expect(phone.locator(".remote-preview img")).toHaveAttribute("src", /^data:image\/svg\+xml,/)
    await phone.getByRole("button", { name: "Loop off" }).click()
    await expect(phone.getByRole("button", { name: "Loop on" })).toBeVisible()
    await phone.getByRole("button", { name: "Mute" }).click()
    await expect(phone.getByRole("button", { name: "Unmute" })).toBeVisible()
    await phone.screenshot({ path: testInfo.outputPath("remote-media-phone-preview.png"), fullPage: true })
    await phone.getByRole("button", { name: "Play on output" }).click()
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_PLAY" && message.data?.path === "/fixture/clip.mp4")).toBe(true)
    await expect(phone.locator(".live-label")).toHaveText("Live on output")
    await expect(phone.locator(".bottom-tabs button[title='Media']")).toHaveAttribute("aria-current", "page")
    await phone.screenshot({ path: testInfo.outputPath("remote-media-phone-playing.png"), fullPage: true })
    const videoLaunch = remoteMessages.filter((message) => message?.channel === "MEDIA_PLAY" && message.data?.path === "/fixture/clip.mp4").at(-1)
    expect(videoLaunch.data.loop).toBe(true)
    expect(videoLaunch.data.muted).toBe(true)
    await phone.getByRole("button", { name: "Back to media" }).click()

    const posterLaunchesBeforeSelect = remoteMessages.filter((message) => message?.channel === "MEDIA_PLAY").length
    await phone.locator(".media-entry").filter({ hasText: "poster.png" }).click()
    await expect(phone.locator(".remote-media-page h2")).toHaveText("poster.png")
    expect(remoteMessages.filter((message) => message?.channel === "MEDIA_PLAY")).toHaveLength(posterLaunchesBeforeSelect)
    await phone.getByRole("button", { name: "Show on output" }).click()
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_PLAY" && message.data?.path === "/fixture/poster.png")).toBe(true)
    await phone.getByRole("button", { name: "Back to media" }).click()

    const mediaPlayCountBeforeAudioSelection = remoteMessages.filter((message) => message?.channel === "MEDIA_PLAY").length
    audioOutputState = { id: "/fixture/song.mp3", paused: false, duration: 180 }
    await phone.locator(".media-entry").filter({ hasText: "song.mp3" }).click()
    await expect(phone.locator(".remote-media-page h2")).toHaveText("song.mp3")
    await expect(phone.getByRole("button", { name: "Pause audio" })).toBeVisible()
    await expect(phone.locator(".audio-time")).toHaveText("01:03 / 03:00")
    expect(remoteMessages.filter((message) => message?.channel === "MEDIA_PLAY")).toHaveLength(mediaPlayCountBeforeAudioSelection)
    await phone.getByRole("button", { name: "Pause audio" }).click()
    await expect(phone.getByRole("button", { name: "Play audio" })).toBeVisible()
    expect(remoteMessages.some((message) => message?.channel === "API:pause_audio" && message.data?.path === "/fixture/song.mp3")).toBe(true)
    await phone.getByRole("button", { name: "Back to media" }).click()

    await phone.getByRole("button", { name: /Next/ }).click()
    await expect(phone.locator(".empty-state")).toContainText("Continue to scan the folder")
    await expect(phone.getByRole("button", { name: /Next/ })).toBeEnabled()
    const fixtureBrowseBeforePageTwo = remoteMessages.filter((message) => message?.channel === "MEDIA_LIST" && message.data?.path === "/fixture")
    await phone.getByRole("button", { name: /Next/ }).click()
    await expect(phone.locator(".media-entry").filter({ hasText: "last.jpg" })).toBeVisible()
    const fixtureBrowsePages = remoteMessages.filter((message) => message?.channel === "MEDIA_LIST" && message.data?.path === "/fixture").slice(-3)
    expect(fixtureBrowsePages.map((message) => message.data.page)).toEqual([0, 1, 2])
    expect(new Set(fixtureBrowsePages.map((message) => message.data.requestId)).size).toBe(1)
    expect(fixtureBrowseBeforePageTwo.at(-1)?.data.page).toBe(1)
    await phone.locator(".bottom-tabs button[title='Control']").click()
    await expect(phone.locator(".notes p")).toContainText("Second line")
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_CANCEL")).toBe(true)
    expect(remoteMessages.filter((message) => message?.channel === "MEDIA_CANCEL").at(-1).data.requestId).toBe(fixtureBrowsePages[0].data.requestId)

    await phone.locator(".bottom-tabs button[title='Media']").click()
    await expect(phone.locator(".media-entry").filter({ hasText: "poster.png" })).toBeVisible()
    cancelNextPageOne = true
    await phone.getByRole("button", { name: /Next/ }).click()
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_LIST" && message.data?.path === "/fixture" && message.data?.page === 1 && cancelNextPageOne === false)).toBe(true)
    const cancelledBrowse = remoteMessages.filter((message) => message?.channel === "MEDIA_LIST" && message.data?.path === "/fixture").at(-1)
    await phone.locator(".bottom-tabs button[title='Control']").click()
    await expect(phone.locator(".notes p")).toContainText("Second line")
    await expect.poll(() => remoteMessages.filter((message) => message?.channel === "MEDIA_CANCEL").at(-1)?.data?.requestId).toBe(cancelledBrowse.data.requestId)
    await phone.locator(".bottom-tabs button[title='Media']").click()
    await expect(phone.locator(".media-entry").filter({ hasText: "poster.png" })).toBeVisible()
    await phone.waitForTimeout(1300)
    await expect(phone.locator(".media-entry").filter({ hasText: "poster.png" })).toBeVisible()
    await expect(phone.locator(".empty-state").filter({ hasText: "Continue to scan the folder" })).toHaveCount(0)
    await phone.close()

    fixtureOutputMediaPath = ""
    const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 } })
    await tablet.addInitScript(() => localStorage.setItem("password", "fixture"))
    await tablet.goto(`http://127.0.0.1:${remotePort}`)
    await expect(tablet.locator(".tabletMode")).toBeVisible()
    await tablet.locator(".drawer .tabs button").filter({ hasText: "Media" }).click()
    await expect(tablet.locator(".media-library")).toBeVisible()
    await expect(tablet.locator(".media-entry").filter({ hasText: "Fixture media" })).toBeVisible()
    await tablet.locator(".media-entry").filter({ hasText: "Fixture media" }).click()
    const tabletLaunchesBeforeSelect = remoteMessages.filter((message) => message?.channel === "MEDIA_PLAY").length
    await tablet.locator(".media-entry").filter({ hasText: "poster.png" }).click()
    await expect(tablet.locator(".remote-media-page h2")).toHaveText("poster.png")
    expect(remoteMessages.filter((message) => message?.channel === "MEDIA_PLAY")).toHaveLength(tabletLaunchesBeforeSelect)
    // Tablet shell adopts the operator tokens (resolved via CSS variables) and stays readable.
    const tabletShell = await tablet.evaluate(() => {
        const resolve = (value: string, property: string) => {
            const probe = document.createElement("div")
            probe.style.cssText = `${property}: ${value}; display: none`
            document.querySelector(".tabletMode")!.appendChild(probe)
            const resolved = getComputedStyle(probe).getPropertyValue(property.startsWith("color") ? "color" : "background-color")
            probe.remove()
            return resolved
        }
        const channels = (css: string) => (css.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
        const luminance = (css: string) => {
            const [r, g, b] = channels(css).map((v) => {
                const c = v / 255
                return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            })
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const contrast = (a: string, b: string) => {
            const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
            return (hi + 0.05) / (lo + 0.05)
        }
        const drawer = getComputedStyle(document.querySelector(".drawer")!)
        const panel = getComputedStyle(document.querySelector(".left-panel")!)
        const surface = resolve("var(--operator-surface)", "background-color")
        const canvas = resolve("var(--operator-canvas)", "background-color")
        const text = resolve("var(--operator-text)", "color")
        return {
            drawerUsesSurface: drawer.backgroundColor === surface,
            panelUsesCanvas: panel.backgroundColor === canvas,
            drawerContrast: contrast(text, drawer.backgroundColor),
            panelContrast: contrast(text, panel.backgroundColor)
        }
    })
    expect(tabletShell.drawerUsesSurface).toBe(true)
    expect(tabletShell.panelUsesCanvas).toBe(true)
    expect(tabletShell.drawerContrast).toBeGreaterThanOrEqual(4.5)
    expect(tabletShell.panelContrast).toBeGreaterThanOrEqual(4.5)
    await tablet.screenshot({ path: testInfo.outputPath("remote-media-tablet-preview.png"), fullPage: true })
    await tablet.getByRole("button", { name: "Show on output" }).click()
    await expect.poll(() => remoteMessages.some((message) => message?.channel === "MEDIA_PLAY" && message.data?.path === "/fixture/poster.png")).toBe(true)
    await tablet.getByRole("button", { name: "Back to media" }).click()
    await expect(tablet.locator(".media-entry").filter({ hasText: "clip.mp4" })).toBeVisible()
    await tablet.screenshot({ path: testInfo.outputPath("remote-media-tablet.png"), fullPage: true })
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
    await expect(controller.locator(".preview-panel .item img").first()).toHaveAttribute("src", /^data:image\/svg\+xml,/)
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
    await controller.getByRole("button", { name: "Next" }).click()
    await expect.poll(() => controllerMessages.some((message) => message?.channel === "ACTION" && message.data?.id === "next")).toBe(true)
    await controller.getByRole("button", { name: "Previous" }).click()
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
