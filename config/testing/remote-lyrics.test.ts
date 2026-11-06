import path from "node:path"
import { createServer as createViteServer, type ViteDevServer } from "vite"
import { Server as SocketServer } from "socket.io"
import { chromium, expect, test, type Browser, type Page } from "@playwright/test"

// iPad Remote lyrics editor against a fake desktop (socket.io, no Electron).

const projectRoot = process.cwd()
const remotePort = 4342

const SAVED_TEXT = "[Verse 1]\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nI once was lost but now am found"
const LONG_LINE = "This single line of lyrics is much longer than any screen can show at once"

type Fixture = { locked: boolean; reply: any; answer: boolean }
const defaults = (): Fixture => ({ locked: false, reply: { status: "saved", showId: "ipad-show" }, answer: true })
let fixture = defaults()
let refuseConnections = false
let sockets: SocketServer
const open: any[] = []
let vite: ViteDevServer
let browser: Browser
const received: any[] = []

const textItem = (value: string) => ({ id: "i-" + value.slice(0, 4), style: "left:160px;top:380px;width:1600px;height:320px;", align: "justify-content:center;", lines: [{ align: "", text: [{ value, style: "font-size:96px;color:#fff;" }] }] })
const slide = (id: string, group: string, lyric: string) => ({ id, group, color: null, settings: {}, notes: "", items: [textItem(lyric)] })

function show() {
    return {
        id: "ipad-show",
        name: "Amazing Grace",
        category: "worship",
        locked: fixture.locked,
        settings: { activeLayout: "default" },
        slides: { s1: slide("s1", "verse", "Amazing grace how sweet the sound"), s2: slide("s2", "verse", "That saved a wretch like me"), s3: slide("s3", "chorus", "I once was lost but now am found") },
        layouts: { default: { name: "Default", notes: "", slides: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] } },
        media: {}
    }
}

test.beforeAll(async () => {
    browser = await chromium.launch()
    process.env.VITE_SERVER_ID = "remote"
    process.env.NODE_ENV = "development"
    vite = (await createViteServer({ configFile: path.join(projectRoot, "config/building/vite.config.servers.mjs"), server: { host: "127.0.0.1", port: remotePort, strictPort: true } })) as ViteDevServer
    await vite.listen()

    sockets = new SocketServer(vite.httpServer!, { serveClient: false })
    sockets.use((_socket, next) => (refuseConnections ? next(new Error("refused")) : next()))
    sockets.on("connection", (socket) => {
        open.push(socket)
        const emit = (channel: string, data: unknown) => socket.emit("REMOTE", { channel, data })
        socket.on("REMOTE", (message) => {
            received.push(message)
            if (message?.channel === "ACCESS") {
                emit("ACCESS", null)
                emit("SHOWS", { "ipad-show": { name: "Amazing Grace", category: "worship" } })
                emit("SHOW", show())
            }
            if (message?.channel === "API:get_plain_text") emit("API:get_plain_text", { id: "ipad-show", value: SAVED_TEXT })
            if (message?.channel === "API:get_groups")
                emit("API:get_groups", {
                    id: "ipad-show",
                    value: [
                        { id: "s1", group: "Verse 1", color: null },
                        { id: "s2", group: "Verse 1", color: null },
                        { id: "s3", group: "Chorus", color: null }
                    ]
                })
            if (message?.channel === "API:set_plain_text" && fixture.answer) emit("API:set_plain_text", fixture.reply)
        })
    })
})

test.afterAll(async () => {
    await sockets?.close()
    await vite?.close()
    await browser?.close()
})

test.beforeEach(() => {
    fixture = defaults()
    refuseConnections = false
    received.length = 0
})

const saveMessages = () => received.filter((m) => m?.channel === "API:set_plain_text")

async function openEditor(page: Page) {
    await page.addInitScript(() => localStorage.setItem("password", "fixture"))
    await page.goto(`http://127.0.0.1:${remotePort}`)
    // the first load after the dev server starts compiles the app, so allow it more time
    await expect(page.locator(".tabletMode")).toBeVisible({ timeout: 40_000 })
    await expect(page.locator(".grid .main").first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    // the desktop's text arrives in the textarea
    await expect(page.locator("textarea")).toHaveValue(SAVED_TEXT)
}

for (const viewport of [
    { width: 1024, height: 1366 },
    { width: 1366, height: 1024 }
]) {
    test(`help, live count, long-line warning, preview and save at ${viewport.width}x${viewport.height}`, async ({}, testInfo) => {
        const page = await browser.newPage({ viewport })
        await openEditor(page)

        // help line, count and preview before any typing
        await expect(page.getByTestId("lyrics-help")).toHaveText("Put a group name on its own line, like [Verse 1] or [Chorus]. Leave a blank line to start a new slide.")
        await expect(page.getByTestId("lyrics-count")).toHaveText("2 slides")
        await expect(page.getByTestId("lyrics-warnings")).toHaveCount(0)
        await expect(page.getByTestId("lyrics-preview")).toBeVisible()
        await expect(page.getByTestId("lyrics-preview-slide")).toHaveCount(2)
        await page.screenshot({ path: testInfo.outputPath(`lyrics-editor-${viewport.width}.png`) })

        // the count follows what is typed
        const area = page.locator("textarea")
        await area.fill(SAVED_TEXT + "\n\n[Verse 2]\nTwas grace that taught my heart to fear")
        await expect(page.getByTestId("lyrics-count")).toHaveText("3 slides")
        await expect(page.getByTestId("lyrics-preview-slide")).toHaveCount(3)
        await area.fill("[Verse 1]\nOne line")
        await expect(page.getByTestId("lyrics-count")).toHaveText("1 slide")

        // a line over 45 characters is flagged, with its slide and line numbers
        await area.fill(SAVED_TEXT + "\n\n[Verse 2]\nShort line\n" + LONG_LINE)
        await expect(page.getByTestId("lyrics-count")).toHaveText("3 slides")
        await expect(page.getByTestId("lyrics-warnings")).toContainText(`Slide 3, line 2 is ${LONG_LINE.length} characters and may not fit on screen.`)
        await expect(page.locator(".slide p.long")).toHaveText(LONG_LINE)
        await page.screenshot({ path: testInfo.outputPath(`lyrics-long-line-${viewport.width}.png`) })

        // typing a draft is not a restore: no message appears, and nothing is sent
        await expect(page.getByTestId("lyrics-message")).toHaveCount(0)
        // nothing is sent while typing
        expect(saveMessages()).toHaveLength(0)

        // save: the message names the show and carries the text, the editor closes and says so
        await page.getByRole("button", { name: "Save" }).click()
        await expect.poll(saveMessages).toHaveLength(1)
        expect(saveMessages()[0].data).toEqual({ id: "ipad-show", value: SAVED_TEXT + "\n\n[Verse 2]\nShort line\n" + LONG_LINE })
        await expect(page.getByTestId("lyrics-saved")).toHaveText("Lyrics saved.")
        await expect(page.locator("textarea")).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath(`lyrics-saved-${viewport.width}.png`) })
        await page.close()
    })
}

test("unchanged text sends nothing", async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await openEditor(page)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.locator("textarea")).toHaveCount(0)
    expect(saveMessages()).toHaveLength(0)
    await page.close()
})

test("a locked show is refused with a reason, and the text stays in the editor", async ({}, testInfo) => {
    fixture.locked = true
    fixture.reply = { status: "blocked", reason: "show_locked", showId: "ipad-show" }
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await openEditor(page)

    await page.locator("textarea").fill(SAVED_TEXT + "\n\n[Bridge]\nNew words")
    await page.getByRole("button", { name: "Save" }).click()
    await expect.poll(saveMessages).toHaveLength(1)
    await expect(page.getByTestId("lyrics-message")).toHaveText("Not saved: this show is locked. Your text is kept.")
    await expect(page.locator("textarea")).toHaveValue(SAVED_TEXT + "\n\n[Bridge]\nNew words")
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath("lyrics-locked.png") })
    await page.close()
})

test("a main app that does not answer leaves the text in the editor", async () => {
    fixture.answer = false
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await openEditor(page)

    await page.locator("textarea").fill("[Verse 1]\nChanged")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled()
    await expect(page.getByTestId("lyrics-message")).toContainText("The main app did not answer", { timeout: 15_000 })
    await expect(page.locator("textarea")).toHaveValue("[Verse 1]\nChanged")
    await page.close()
})

test("a dropped connection sends nothing and the typed text comes back after reconnect", async ({}, testInfo) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await openEditor(page)
    await page.locator("textarea").fill("[Verse 1]\nTyped while the wifi dropped")

    // while offline the Remote shows its sign-in view: there is no Save button left to tap
    refuseConnections = true
    // drop the transport like a lost network: the client reconnects by itself once connections are accepted again
    open.splice(0).forEach((socket) => socket.conn.close())
    await expect(page.locator("textarea")).toHaveCount(0)
    await expect(page.getByText("Password", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("lyrics-offline.png") })
    expect(saveMessages()).toHaveLength(0)

    refuseConnections = false
    await expect(page.locator("textarea")).toHaveValue("[Verse 1]\nTyped while the wifi dropped", { timeout: 20_000 })
    await expect(page.getByTestId("lyrics-message")).toHaveText("Your unsaved text was restored.")
    await page.screenshot({ path: testInfo.outputPath("lyrics-restored.png") })
    expect(saveMessages()).toHaveLength(0)

    await page.getByRole("button", { name: "Save" }).click()
    await expect.poll(saveMessages).toHaveLength(1)
    expect(saveMessages()[0].data.value).toBe("[Verse 1]\nTyped while the wifi dropped")
    await page.close()
})

test("group reordering still sends the rearrange message", async ({}, testInfo) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await page.addInitScript(() => localStorage.setItem("password", "fixture"))
    await page.goto(`http://127.0.0.1:${remotePort}`)
    await expect(page.locator(".tabletMode")).toBeVisible({ timeout: 40_000 })
    await expect(page.locator(".grid .main").first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole("button", { name: "Groups", exact: true }).click()
    const rows = page.locator("#sortable > *")
    await expect(rows).toHaveCount(3)
    await page.screenshot({ path: testInfo.outputPath("groups-edit.png") })

    await rows.nth(0).dragTo(rows.nth(2))
    await expect.poll(() => received.filter((m) => m?.channel === "API:rearrange_groups").length).toBe(1)
    expect(received.find((m) => m?.channel === "API:rearrange_groups").data).toMatchObject({ showId: "ipad-show", from: 0 })
    await page.close()
})
