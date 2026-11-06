import path from "node:path"
import { createServer as createViteServer, type ViteDevServer } from "vite"
import { Server as SocketServer } from "socket.io"
import { chromium, expect, test, type Browser, type Page } from "@playwright/test"

// iPad Remote Templates drawer against a fake desktop (socket.io, no Electron).

const projectRoot = process.cwd()
const remotePort = 4341

type Fixture = { showTemplate: string; categoryTemplate: string; outputStyleTemplate: string; locked: boolean; reply: any }
const defaults = (): Fixture => ({ showTemplate: "t1", categoryTemplate: "", outputStyleTemplate: "", locked: false, reply: null })
let fixture = defaults()
let refuseConnections = false
let sockets: SocketServer
const open: any[] = []
let vite: ViteDevServer
let browser: Browser
const received: any[] = []

const textItem = (value: string, extra = "") => ({ id: "i-" + value.slice(0, 4), style: `left:160px;top:380px;width:1600px;height:320px;${extra}`, align: "justify-content:center;", lines: [{ align: "", text: [{ value, style: "font-size:96px;color:#fff;" }] }] })
const slide = (id: string, group: string, lyric: string) => ({ id, group, color: null, settings: {}, notes: "", items: [textItem(lyric)] })

function show() {
    return {
        id: "ipad-show",
        name: "Amazing Grace",
        category: "worship",
        locked: fixture.locked,
        settings: { activeLayout: "default", template: fixture.showTemplate },
        slides: { s1: slide("s1", "verse", "Amazing grace how sweet the sound"), s2: slide("s2", "verse", "That saved a wretch like me"), s3: slide("s3", "chorus", "I once was lost but now am found") },
        layouts: { default: { name: "Default", notes: "", slides: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] } },
        media: {}
    }
}

const templates = {
    t1: { name: "Lyrics classic", category: null, color: "#333", items: [textItem("Aa")], settings: {} },
    t2: { name: "Big center", category: null, color: "#333", items: [textItem("Aa", "background:#222;")], settings: {} },
    t3: { name: "Lower third", category: null, color: "#333", items: [textItem("Aa")], settings: {} }
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
                emit("CATEGORIES", { worship: { name: "Worship", ...(fixture.categoryTemplate ? { template: fixture.categoryTemplate } : {}) } })
                emit("OUTPUT_STYLE_TEMPLATE", fixture.outputStyleTemplate || null)
                emit("SHOW", show())
            }
            if (message?.channel === "GET_TEMPLATES") emit("GET_TEMPLATES", { templates, categories: {}, outputStyleTemplate: fixture.outputStyleTemplate || null })
            if (message?.channel === "API:set_template") emit("API:set_template", fixture.reply)
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

const setTemplateMessages = () => received.filter((m) => m?.channel === "API:set_template")

async function openTemplates(page: Page) {
    await page.addInitScript(() => localStorage.setItem("password", "fixture"))
    await page.goto(`http://127.0.0.1:${remotePort}`)
    // the first load after the dev server starts compiles the app, so allow it more time
    await expect(page.locator(".tabletMode")).toBeVisible({ timeout: 40_000 })
    await expect(page.locator(".grid .main").first()).toBeVisible({ timeout: 20_000 })
    await page.locator(".drawer .tabs button").filter({ hasText: "Templates" }).click()
    await expect(page.locator(".template-card")).toHaveCount(3)
}

const card = (page: Page, name: string) => page.locator(".template-card").filter({ hasText: name })

for (const viewport of [
    { width: 1024, height: 1366 },
    { width: 1366, height: 1024 }
]) {
    test(`scope switch, target line, In use badge and scoped message at ${viewport.width}x${viewport.height}`, async ({}, testInfo) => {
        fixture.reply = { status: "applied", showId: "ipad-show", scope: "show", count: 3 }
        const page = await browser.newPage({ viewport })
        await openTemplates(page)

        // target line and In use badge, before any tap
        await expect(page.getByTestId("template-target")).toHaveText("Whole show")
        await expect(page.getByTestId("template-in-use")).toHaveCount(1)
        await expect(card(page, "Lyrics classic").getByTestId("template-in-use")).toHaveText("In use")
        await expect(page.getByTestId("template-in-use-line")).toContainText("Lyrics classic (show)")
        await expect(page.getByTestId("template-category-warning")).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath(`templates-show-scope-${viewport.width}.png`) })

        // whole show: the message names the show open on the iPad
        await card(page, "Big center").locator("button").click()
        await expect.poll(setTemplateMessages).toHaveLength(1)
        expect(setTemplateMessages()[0].data).toEqual({ id: "t2", showId: "ipad-show", scope: "show" })
        await expect(page.getByTestId("template-result")).toHaveText("Template applied to the whole show.")

        // selected slides: taps pick slides instead of playing them
        await page.getByRole("button", { name: "Selected slides" }).click()
        await expect(page.getByTestId("template-target")).toHaveText("Tap slides in the show to select them")
        await expect(card(page, "Big center").locator("button")).toBeDisabled()
        await page.locator(".slide[data-index=\'0\']").click()
        await page.locator(".slide[data-index=\'2\']").click()
        await expect(page.getByTestId("template-target")).toHaveText("2 selected slides")
        await expect(page.locator(".slide.picked")).toHaveCount(2)
        expect(received.some((m) => m?.channel === "API:index_select_slide")).toBe(false)
        await page.screenshot({ path: testInfo.outputPath(`templates-slides-scope-${viewport.width}.png`) })

        fixture.reply = { status: "applied", showId: "ipad-show", scope: "slides", count: 2 }
        await card(page, "Lower third").locator("button").click()
        await expect.poll(setTemplateMessages).toHaveLength(2)
        expect(setTemplateMessages()[1].data).toEqual({ id: "t3", showId: "ipad-show", scope: "slides", slides: [0, 2] })
        await expect(page.getByTestId("template-result")).toHaveText("Template applied to 2 slides.")

        // back to whole show: slides play again
        await page.getByRole("button", { name: "Whole show" }).click()
        await expect(page.locator(".slide.picked")).toHaveCount(0)
        await page.locator(".slide[data-index=\'1\']").click()
        await expect.poll(() => received.some((m) => m?.channel === "API:index_select_slide")).toBe(true)
        await page.close()
    })
}

test("category template warns before the tap, and a blocked reply is shown", async ({}, testInfo) => {
    fixture.categoryTemplate = "t3"
    fixture.reply = { status: "blocked", reason: "category_template", showId: "ipad-show" }
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await openTemplates(page)

    await expect(page.getByTestId("template-category-warning")).toContainText('Category "Worship" sets the template "Lower third"')
    await expect(page.getByTestId("template-in-use-line")).toContainText("Lower third (category)")
    await expect(card(page, "Lower third").getByTestId("template-in-use")).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("templates-category-warning.png") })

    await card(page, "Big center").locator("button").click()
    await expect(page.getByTestId("template-result")).toHaveText("Not applied: the show's category sets its own template.")
    await page.screenshot({ path: testInfo.outputPath("templates-category-blocked.png") })

    // selected slides are not blocked by the category template, so the warning goes away
    await page.getByRole("button", { name: "Selected slides" }).click()
    await page.locator(".slide[data-index=\'0\']").click()
    await expect(page.getByTestId("template-category-warning")).toHaveCount(0)
    await page.close()
})

test("a locked show is reported on the iPad instead of failing silently", async ({}, testInfo) => {
    fixture.locked = true
    fixture.reply = { status: "blocked", reason: "show_locked", showId: "ipad-show" }
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await openTemplates(page)

    await card(page, "Big center").locator("button").click()
    await expect.poll(setTemplateMessages).toHaveLength(1)
    await expect(page.getByTestId("template-result")).toHaveText("Not applied: this show is locked.")
    await page.screenshot({ path: testInfo.outputPath("templates-locked.png") })
    await page.close()
})

test("an output style template warns before the tap", async () => {
    fixture.outputStyleTemplate = "t3"
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await openTemplates(page)

    await expect(page.getByTestId("template-style-warning")).toContainText('The output style template "Lower third" overrides what is shown on screen.')
    await page.close()
})

test("a dropped connection takes the template taps away and nothing is replayed on reconnect", async ({}, testInfo) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } })
    await openTemplates(page)
    await expect(card(page, "Big center").locator("button")).toBeEnabled()

    // while offline the Remote shows its sign-in view: there is no template card left to tap
    refuseConnections = true
    // drop the transport like a lost network: the client reconnects by itself once connections are accepted again
    open.splice(0).forEach((socket) => socket.conn.close())
    await expect(page.locator(".template-card")).toHaveCount(0)
    await expect(page.getByText("Password", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("templates-offline.png") })

    refuseConnections = false
    await expect(page.locator(".tabletMode")).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(500)
    expect(setTemplateMessages()).toHaveLength(0)
    await page.close()
})
