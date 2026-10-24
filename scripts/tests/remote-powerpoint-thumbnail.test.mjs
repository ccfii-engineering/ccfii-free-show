import assert from "node:assert/strict"
import { test } from "node:test"
import { chromium } from "playwright"
import { createServer } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import sveltePreprocess from "svelte-preprocess"

test("remote PowerPoint media requests and renders thumbnails in the slide grid and selected preview", { timeout: 20_000 }, async () => {
    const server = await createServer({
        configFile: false,
        root: process.cwd(),
        plugins: [
            svelte({
                preprocess: sveltePreprocess({ typescript: { tsconfigFile: "config/typescript/tsconfig.svelte.json" } })
            }),
            {
                name: "remote-thumbnail-test-api",
                enforce: "pre",
                resolveId(source, importer) {
                    if (source === "../../util/socket" && importer?.includes("/src/server/remote/components/show/Textbox.svelte")) return "\0remote-thumbnail-test-api"
                },
                load(id) {
                    if (id !== "\0remote-thumbnail-test-api") return
                    return `
                        export function send(channel, data) {
                            window.remoteThumbnailRequests.push({ channel, data })
                            if (channel !== "API:get_thumbnail") return
                            setTimeout(() => window.remoteThumbnailProvider(channel, data), 0)
                        }
                    `
                }
            }
        ],
        server: { host: "127.0.0.1", port: 0, strictPort: false },
        resolve: { dedupe: ["svelte"] },
        optimizeDeps: { noDiscovery: true, include: [] },
        appType: "mpa",
        logLevel: "error"
    })
    const browser = await chromium.launch({ headless: true })

    try {
        await server.listen()
        const address = server.httpServer?.address()
        assert.ok(address && typeof address !== "string", "Vite did not start an HTTP listener")

        const page = await browser.newPage()
        const thumbnailPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64")
        await page.route(/^https?:\/\/direct\.example\.test\/image\.png$/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: thumbnailPng }))
        await page.goto(`http://127.0.0.1:${address.port}/scripts/tests/fixtures/remote-powerpoint-thumbnail.html`)
        await page.waitForFunction(() => window.remoteThumbnailReady === true)

        const result = await page.evaluate(() => ({
            requests: window.remoteThumbnailRequests,
            images: Array.from(document.querySelectorAll("img"), (image) => ({ src: image.currentSrc, naturalWidth: image.naturalWidth }))
        }))
        console.log("Remote PowerPoint thumbnail browser result:", JSON.stringify(result))

        assert.ok(result.requests.length >= 1, "remote media should request its imported thumbnail")
        assert.ok(result.requests.every((request) => request.channel === "API:get_thumbnail" && ["C:\\PowerPoint Imports\\Deck One\\image 1.png", "C:\\PowerPoint Imports\\Deck One\\image 2.png"].includes(request.data.path)))
        assert.ok(result.requests.some((request) => request.data.path === "C:\\PowerPoint Imports\\Deck One\\image 1.png"))
        assert.ok(
            result.requests.some((request) => request.data.path === "C:\\PowerPoint Imports\\Deck One\\image 2.png"),
            "changing the media source should request its new thumbnail"
        )
        assert.ok(result.requests.length <= 4, "each component should request an uncached local source only once")
        assert.equal(result.images.length, 7)
        assert.ok(
            result.images.slice(0, 3).every((image) => image.naturalWidth > 0),
            "grid and selected preview should decode non-empty local thumbnails"
        )
        assert.ok(result.images[3].naturalWidth > 0, "direct data URLs should remain renderable")
        assert.ok(result.images[4].naturalWidth > 0, "direct blob URLs should remain renderable")
        assert.ok(result.images[5].naturalWidth > 0 && result.images[6].naturalWidth > 0, "direct HTTP and HTTPS URLs should remain renderable")
    } finally {
        await browser.close()
        await server.close()
    }
})
