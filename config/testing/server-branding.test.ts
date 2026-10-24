import { spawnSync } from "node:child_process"
import { createServer as createHttpServer, type Server as HttpServer } from "node:http"
import { readFileSync } from "node:fs"
import path from "node:path"
import express from "express"
import { Server as SocketServer } from "socket.io"
import { chromium, expect, test, type Browser, type Page } from "@playwright/test"
import { createServer as createViteServer, type ViteDevServer } from "vite"

const projectRoot = process.cwd()
const appIds = ["remote", "stage", "controller", "output_stream"] as const
type AppId = (typeof appIds)[number]
type RuntimeServer = { close: () => Promise<void> }
type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string }
type ServerManifest = { icons: ManifestIcon[] }

const devPorts: Record<AppId, number> = { remote: 4311, stage: 4312, controller: 4313, output_stream: 4314 }
const prodPorts: Record<AppId, number> = { remote: 4321, stage: 4322, controller: 4323, output_stream: 4324 }
const appNames: Record<AppId, string> = {
    remote: "FreeShow Remote - CCFII Edition",
    stage: "FreeShow Stage - CCFII Edition",
    controller: "FreeShow Controller - CCFII Edition",
    output_stream: "FreeShow Output - CCFII Edition"
}

let browser: Browser
const runningServers: RuntimeServer[] = []

function attachSocketStub(server: HttpServer) {
    const sockets = new SocketServer(server, { serveClient: false })

    sockets.on("connection", (socket) => {
        socket.on("REMOTE", (message) => {
            if (message?.channel === "PASSWORD") {
                socket.emit("REMOTE", { channel: "PASSWORD", data: { password: true } })
            }
        })

        socket.on("STAGE", (message) => {
            if (message?.channel === "LAYOUTS") {
                socket.emit("STAGE", {
                    channel: "LAYOUTS",
                    data: [
                        { id: "main-stage", name: "Main Stage", password: false },
                        { id: "confidence", name: "Confidence Monitor", password: true }
                    ]
                })
            }
        })
    })

    return sockets
}

function pngDimensions(bytes: Buffer) {
    expect(bytes.toString("hex", 0, 8)).toBe("89504e470d0a1a0a")
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function assertManifestIconDimensions(icons: ManifestIcon[], bytes: Buffer, label: string) {
    const { width, height } = pngDimensions(bytes)
    expect(icons.length, `${label} icon count`).toBeGreaterThan(0)

    for (const icon of icons) {
        expect(icon.type, `${label} ${icon.src} type`).toBe("image/png")
        const declaredSizes = icon.sizes.split(/\s+/).filter(Boolean)
        expect(declaredSizes, `${label} ${icon.src} declared sizes`).toContain(`${width}x${height}`)
        expect(
            declaredSizes.every((size) => size === `${width}x${height}`),
            `${label} ${icon.src} sizes match PNG dimensions`
        ).toBe(true)
    }
}

async function startDevServer(appId: AppId, port: number): Promise<RuntimeServer> {
    process.env.VITE_SERVER_ID = appId
    process.env.NODE_ENV = "development"

    const vite = (await createViteServer({
        configFile: path.join(projectRoot, "config/building/vite.config.servers.mjs"),
        server: { host: "127.0.0.1", port, strictPort: true }
    })) as ViteDevServer
    await vite.listen()
    const sockets = attachSocketStub(vite.httpServer!)

    return {
        close: async () => {
            await sockets.close()
            await vite.close()
        }
    }
}

async function startProdServer(appId: AppId, port: number): Promise<RuntimeServer> {
    const distPath = path.join(projectRoot, "build/electron", appId)
    const app = express()
    app.use(express.static(distPath))
    const server = createHttpServer(app)
    const sockets = attachSocketStub(server)

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, "127.0.0.1", () => resolve())
    })

    return {
        close: async () => {
            await sockets.close()
        }
    }
}

async function assertCcfiiAssets(page: Page, baseUrl: string) {
    const expectedIcon = readFileSync(path.join(projectRoot, "public/icon.png"))
    const expectedLogo = readFileSync(path.join(projectRoot, "public/ccfii-logo.png"))

    for (const iconPath of ["/ccfii-icon.png", "/icon.png"]) {
        const response = await page.request.get(`${baseUrl}${iconPath}`)
        expect(response.status(), `${baseUrl}${iconPath}`).toBe(200)
        const image = Buffer.from(await response.body())
        expect(image.equals(expectedIcon)).toBe(true)
        expect(image.readUInt32BE(16)).toBe(512)
        expect(image.readUInt32BE(20)).toBe(512)
    }

    const logo = page.locator(".brand-logo").first()
    await expect(logo).toBeVisible()
    await expect(logo).toHaveJSProperty("complete", true)
    await expect(logo).toHaveJSProperty("naturalWidth", 658)
    const logoUrl = await logo.getAttribute("src")
    expect(logoUrl).toBe("/ccfii-logo.png")

    const logoResponse = await page.request.get(new URL(logoUrl!, baseUrl).href)
    expect(logoResponse.status()).toBe(200)
    const logoBytes = Buffer.from(await logoResponse.body())
    expect(logoBytes.equals(expectedLogo)).toBe(true)
    expect(logoBytes.readUInt32BE(16)).toBe(658)
    expect(logoBytes.readUInt32BE(20)).toBe(658)
}

test.beforeAll(async () => {
    const build = spawnSync("npm", ["run", "build:servers:prod"], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: "inherit"
    })
    if (build.status !== 0) throw new Error("Production server build failed before branding browser checks")

    browser = await chromium.launch()

    for (const appId of appIds) runningServers.push(await startDevServer(appId, devPorts[appId]))
    for (const appId of appIds) runningServers.push(await startProdServer(appId, prodPorts[appId]))
})

test.afterAll(async () => {
    for (const server of runningServers.reverse()) await server.close()
    await browser?.close()
})

test("all active server shells expose branded metadata and fresh CCFII assets in dev and production", async () => {
    for (const environment of ["dev", "prod"] as const) {
        const ports = environment === "dev" ? devPorts : prodPorts
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

        for (const appId of appIds) {
            const baseUrl = `http://127.0.0.1:${ports[appId]}`
            await page.goto(baseUrl)
            await expect(page).toHaveTitle(appNames[appId])

            const iconLink = await page.locator('link[rel="icon"]').getAttribute("href")
            expect(iconLink).toBe("ccfii-icon.png")

            const manifestResponse = await page.request.get(`${baseUrl}/manifest.json`)
            expect(manifestResponse.status()).toBe(200)
            const manifest = await manifestResponse.json()
            expect(manifest.name).toBe(appNames[appId])
            expect(manifest.icons[0].src).toBe("ccfii-icon.png")

            if (appId === "remote" || appId === "stage") await assertCcfiiAssets(page, baseUrl)

            if (appId === "controller") {
                await expect(page.locator(".operator-brand .brand-copy")).toContainText("FreeShow")
                await expect(page.locator(".operator-brand .brand-edition")).toHaveText("CCFII Edition")
                await expect(page.locator("button")).toHaveCount(5)
                await assertCcfiiAssets(page, baseUrl)
                if (environment === "prod") await page.screenshot({ path: "/tmp/ccfii-brand-controller-desktop.png" })
            }

            if (appId === "output_stream") {
                await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)")
                await expect(page.locator(".brand-lockup")).toHaveCount(0)
                if (environment === "prod") await page.screenshot({ path: "/tmp/ccfii-brand-output-stream.png" })
            }
        }

        await page.close()
    }
})

test("active manifest icon sizes match downloaded PNG dimensions and dormant camera metadata matches its asset", async () => {
    for (const environment of ["dev", "prod"] as const) {
        const ports = environment === "dev" ? devPorts : prodPorts

        for (const appId of appIds) {
            const baseUrl = `http://127.0.0.1:${ports[appId]}`
            const context = await browser.newContext()
            try {
                const response = await context.request.get(`${baseUrl}/manifest.json`)
                expect(response.status(), `${environment}/${appId} manifest`).toBe(200)
                const manifest = (await response.json()) as ServerManifest

                for (const icon of manifest.icons) {
                    const iconUrl = new URL(icon.src, `${baseUrl}/`).href
                    const iconResponse = await context.request.get(iconUrl)
                    expect(iconResponse.status(), `${environment}/${appId} ${icon.src}`).toBe(200)
                    assertManifestIconDimensions([icon], Buffer.from(await iconResponse.body()), `${environment}/${appId}`)
                }
            } finally {
                await context.close()
            }
        }
    }

    const cameraManifest = JSON.parse(readFileSync(path.join(projectRoot, "src/server/cam/manifest.json"), "utf8")) as ServerManifest
    const cameraIcon = readFileSync(path.join(projectRoot, "public/icon.png"))
    expect(cameraManifest.icons[0].src).toBe("ccfii-icon.png")
    assertManifestIconDimensions(cameraManifest.icons, cameraIcon, "dormant camera static metadata")
})

test("remote password and stage selection states show the CCFII lockup on desktop, tablet, and mobile", async () => {
    for (const environment of ["dev", "prod"] as const) {
        const ports = environment === "dev" ? devPorts : prodPorts

        for (const viewport of [
            { width: 1440, height: 900 },
            { width: 1024, height: 768 },
            { width: 390, height: 844 }
        ]) {
            const page = await browser.newPage({ viewport })
            const remoteUrl = `http://127.0.0.1:${ports.remote}`
            await page.goto(remoteUrl)
            await expect(page.locator("#password-input")).toBeVisible()
            await expect(page.locator(".brand-name")).toHaveText("FreeShow")
            await expect(page.locator(".brand-edition")).toHaveText("CCFII Edition")
            await expect(page.locator(".brand-role")).toHaveText("Remote")
            await assertCcfiiAssets(page, remoteUrl)
            if (environment === "prod") await page.screenshot({ path: `/tmp/ccfii-brand-remote-auth-${viewport.width}.png` })

            const stageUrl = `http://127.0.0.1:${ports.stage}`
            await page.goto(stageUrl)
            await expect(page.locator(".layout-button")).toHaveCount(2)
            await expect(page.locator(".brand-name")).toHaveText("FreeShow")
            await expect(page.locator(".brand-edition")).toHaveText("CCFII Edition")
            await expect(page.locator(".brand-role")).toHaveText("Stage")
            await assertCcfiiAssets(page, stageUrl)
            if (environment === "prod") await page.screenshot({ path: `/tmp/ccfii-brand-stage-selection-${viewport.width}.png` })

            await page.close()
        }
    }
})

test("the production service worker removes only its own legacy caches", async () => {
    const page = await browser.newPage()
    const baseUrl = `http://127.0.0.1:${prodPorts.remote}`
    await page.route("**/sw.js", (route) => route.abort())
    await page.goto(baseUrl)

    await page.evaluate(async () => {
        await caches.open("1.0.0fundamentals")
        await caches.open("1.0.0pages")
        await caches.open("freeshow-ccfii-1.0.0-fundamentals")
        await caches.open("unrelated-app-cache")
    })

    await page.unroute("**/sw.js")
    await page.reload()
    await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        if (!registration.active) throw new Error("Service worker did not activate")
    })

    const cacheNames = await page.evaluate(() => caches.keys())
    expect(cacheNames).toContain("unrelated-app-cache")
    expect(cacheNames).toContain("freeshow-ccfii-1.0.1-fundamentals")
    expect(cacheNames).not.toContain("1.0.0fundamentals")
    expect(cacheNames).not.toContain("1.0.0pages")
    expect(cacheNames).not.toContain("freeshow-ccfii-1.0.0-fundamentals")
    await page.close()
})
