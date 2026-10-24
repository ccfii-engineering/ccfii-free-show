import { createServer } from "vite"
import { chromium, expect, test } from "@playwright/test"
import { createServer as createHttpServer, type Server } from "node:http"
import { AddressInfo } from "node:net"
import { unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

function makePdfFixture() {
    const content = (width: number, height: number) => ["q", "1 1 1 rg", `0 0 ${width} ${height} re f`, "0 0 0 RG", "2 w", `4 4 ${width - 8} ${height - 8} re S`, "1 0 0 rg", "8 8 30 30 re f", "0 1 0 rg", `${width - 38} 8 30 30 re f`, "0 0 1 rg", `8 ${height - 38} 30 30 re f`, "1 0 1 rg", `${width - 38} ${height - 38} 30 30 re f`, "BT /F1 24 Tf 60 145 Td (PDF_RENDER_TEXT) Tj ET", "q", `50 0 0 50 ${Math.round(width / 2 - 25)} ${Math.round(height / 2 - 25)} cm`, "/Im1 Do", "Q", "Q"].join("\n")
    const streamObject = (data: string) => `<< /Length ${Buffer.byteLength(data, "ascii")} >>\nstream\n${data}\nendstream`
    const imageHex = ["ff0000", "00ff00", "0000ff", "ffffff"].join("") + ">"
    const imageObject = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${imageHex.length} >>\nstream\n${imageHex}\nendstream`
    const resources = "/Resources << /Font << /F1 7 0 R >> /XObject << /Im1 8 0 R >> >>"
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] ${resources} /Contents 5 0 R >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] ${resources} /Contents 6 0 R >>`, streamObject(content(400, 300)), streamObject(content(300, 400)), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", imageObject]

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

test("PDF.js render job rasterizes real pages sequentially and preserves page edges in a 16:9 view", async () => {
    test.setTimeout(120_000)

    const fixture = makePdfFixture()
    const htmlName = `__pdf-render-${Date.now()}.html`
    const htmlPath = path.join(process.cwd(), "public", htmlName)
    writeFileSync(htmlPath, "<!doctype html><html><body style='margin:0'></body><script type='module'>import * as pdfjs from 'pdfjs-dist'; window.pdfjs = pdfjs; window.pdfjsReady = true</script></html>")

    const vite = await createServer({
        configFile: path.join(process.cwd(), "vite.config.mjs"),
        logLevel: "error",
        server: { host: "127.0.0.1", port: 0, strictPort: false }
    })
    let pdfServer: Server | undefined
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

    try {
        await vite.listen()
        const viteAddress = vite.httpServer?.address() as AddressInfo
        pdfServer = createHttpServer((request, response) => {
            response.setHeader("Access-Control-Allow-Origin", "*")
            response.setHeader("Access-Control-Expose-Headers", "Content-Length")
            response.setHeader("Content-Type", "application/pdf")
            response.setHeader("Content-Length", fixture.length)

            if (request.url === "/slow.pdf") {
                const timer = setTimeout(() => {
                    if (!response.destroyed) response.end(fixture)
                }, 1500)
                response.on("close", () => clearTimeout(timer))
                return
            }

            response.end(fixture)
        })
        await new Promise<void>((resolve) => pdfServer!.listen(0, "127.0.0.1", resolve))
        const pdfAddress = pdfServer.address() as AddressInfo
        const pdfUrl = `http://127.0.0.1:${pdfAddress.port}/fixture.pdf`
        const slowPdfUrl = `http://127.0.0.1:${pdfAddress.port}/slow.pdf`

        browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
        const pageErrors: string[] = []
        page.on("pageerror", (error) => pageErrors.push(error.message))
        await page.goto(`http://127.0.0.1:${viteAddress.port}/${htmlName}`)
        await page.waitForFunction(() => (window as any).pdfjsReady)

        const rendered = await page.evaluate(
            async ({ pdfUrl, slowPdfUrl }) => {
                const pdfjs = (window as any).pdfjs
                pdfjs.GlobalWorkerOptions.workerSrc = "./assets/pdf.worker.min.mjs"
                const textDocument = await pdfjs.getDocument(pdfUrl).promise
                const textPage = await textDocument.getPage(1)
                const extractedText = (await textPage.getTextContent()).items.map((item: any) => item.str).join(" ")
                const pagePrototype = Object.getPrototypeOf(textPage)
                const originalRender = pagePrototype.render
                await textDocument.destroy()

                const { openPdfRenderJob, renderPdfPage, closePdfRenderJob } = await import("/src/frontend/components/actions/pdfRenderJob.ts")
                const renderBounds = { maxWidth: 1920, maxHeight: 1080, maxPixels: 1920 * 1080 }
                const abortController = new AbortController()
                const pendingOpen = openPdfRenderJob({ jobId: "cancel-open", pdfPath: slowPdfUrl }, abortController.signal).then(
                    () => false,
                    () => true
                )
                setTimeout(() => abortController.abort(), 30)
                const openWasCancelled = await pendingOpen

                const open = await openPdfRenderJob({ jobId: "fixture", pdfPath: pdfUrl })
                const firstPage = await renderPdfPage({ jobId: "fixture", pageIndex: 0, ...renderBounds, format: "png" })
                const secondPage = await renderPdfPage({ jobId: "fixture", pageIndex: 1, ...renderBounds, format: "png" })

                const pageController = new AbortController()
                let cancelNextRender = true
                let renderTaskCancelled = false
                pagePrototype.render = function (...args: any[]) {
                    const task = originalRender.apply(this, args)
                    if (cancelNextRender) {
                        cancelNextRender = false
                        const cancel = task.cancel.bind(task)
                        task.cancel = () => {
                            renderTaskCancelled = true
                            cancel()
                        }
                        queueMicrotask(() => pageController.abort())
                    }
                    return task
                }
                const pageRenderWasCancelled = await renderPdfPage({ jobId: "fixture", pageIndex: 0, ...renderBounds, format: "png" }, pageController.signal).then(
                    () => false,
                    () => true
                )
                pagePrototype.render = originalRender
                const pageAfterCancel = await renderPdfPage({ jobId: "fixture", pageIndex: 0, ...renderBounds, format: "png" })

                const blobUrl = URL.createObjectURL(new Blob([firstPage.png], { type: "image/png" }))
                const image = new Image()
                image.src = blobUrl
                await image.decode()
                image.style.cssText = "width:1920px;height:1080px;object-fit:contain;object-position:center;"
                document.body.append(image)

                const output = document.createElement("canvas")
                output.width = 1920
                output.height = 1080
                const context = output.getContext("2d")!
                context.fillStyle = "rgb(32,32,32)"
                context.fillRect(0, 0, output.width, output.height)
                const fitScale = Math.min(output.width / image.naturalWidth, output.height / image.naturalHeight)
                const fitWidth = image.naturalWidth * fitScale
                const fitHeight = image.naturalHeight * fitScale
                const fitX = (output.width - fitWidth) / 2
                const fitY = (output.height - fitHeight) / 2
                context.drawImage(image, fitX, fitY, fitWidth, fitHeight)

                const sample = (x: number, y: number) => Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3)
                const x = (ratio: number) => fitX + fitWidth * ratio
                const y = (ratio: number) => fitY + fitHeight * ratio
                const corners = [sample(x(23 / 400), y(23 / 300)), sample(x(377 / 400), y(23 / 300)), sample(x(23 / 400), y(277 / 300)), sample(x(377 / 400), y(277 / 300))]

                await closePdfRenderJob({ jobId: "fixture" })
                await closePdfRenderJob({ jobId: "fixture" })
                URL.revokeObjectURL(blobUrl)

                return {
                    openWasCancelled,
                    open,
                    pageRenderWasCancelled,
                    renderTaskCancelled,
                    pageAfterCancel: { width: pageAfterCancel.width, height: pageAfterCancel.height },
                    firstPage: { width: firstPage.width, height: firstPage.height, bytes: firstPage.png.byteLength },
                    secondPage: { width: secondPage.width, height: secondPage.height, bytes: secondPage.png.byteLength },
                    extractedText,
                    objectFit: getComputedStyle(image).objectFit,
                    fitScale,
                    fitX,
                    corners
                }
            },
            { pdfUrl, slowPdfUrl }
        )

        expect(pageErrors).toEqual([])
        expect(rendered.openWasCancelled).toBe(true)
        expect(rendered.open.pageCount).toBe(2)
        expect(rendered.open.rendererVersion).toMatch(/^\d+\.\d+/)
        expect(rendered.pageRenderWasCancelled).toBe(true)
        expect(rendered.renderTaskCancelled).toBe(true)
        expect(rendered.pageAfterCancel.width * rendered.pageAfterCancel.height).toBeLessThanOrEqual(1920 * 1080)
        expect(rendered.firstPage.width * rendered.firstPage.height).toBeLessThanOrEqual(1920 * 1080)
        expect(rendered.secondPage.width * rendered.secondPage.height).toBeLessThanOrEqual(1920 * 1080)
        expect(rendered.firstPage.width).toBeLessThanOrEqual(1920)
        expect(rendered.firstPage.height).toBeLessThanOrEqual(1080)
        expect(rendered.secondPage.width).toBeLessThanOrEqual(1920)
        expect(rendered.secondPage.height).toBeLessThanOrEqual(1080)
        expect(rendered.firstPage.width / rendered.firstPage.height).toBeCloseTo(4 / 3, 2)
        expect(rendered.secondPage.width / rendered.secondPage.height).toBeCloseTo(3 / 4, 2)
        expect(rendered.firstPage.bytes).toBeGreaterThan(1000)
        expect(rendered.secondPage.bytes).toBeGreaterThan(1000)
        expect(rendered.extractedText).toContain("PDF_RENDER_TEXT")
        expect(rendered.objectFit).toBe("contain")
        expect(rendered.fitX).toBeGreaterThan(0)
        expect(rendered.corners).toEqual([
            [0, 0, 255],
            [255, 0, 255],
            [255, 0, 0],
            [0, 255, 0]
        ])
    } finally {
        await browser?.close()
        await new Promise<void>((resolve) => (pdfServer ? pdfServer.close(() => resolve()) : resolve()))
        await vite.close()
        unlinkSync(htmlPath)
    }
})
