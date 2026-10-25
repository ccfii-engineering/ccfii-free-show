const assert = require("node:assert/strict")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const { randomBytes } = require("node:crypto")
const { deflateSync } = require("node:zlib")
const { app, BrowserWindow, ipcMain } = require("electron")
const { unzipSync, zipSync, strToU8 } = require("fflate")

const projectRoot = path.resolve(__dirname, "../../..")
const fixturePath = process.argv[process.argv.indexOf("--fixture") + 1]
const { preflightPowerPointArchive } = require(path.join(projectRoot, "build/electron/data/powerpointArchivePreflight.js"))
const { closePowerPointRenderer, getPowerPointRendererPids, getPowerPointRendererSessionCount, openPowerPointRenderer, renderPowerPointPage } = require(path.join(projectRoot, "build/electron/data/powerpointRenderer.js"))

const createdContents = []
let cancelOnRequest
const requestChannel = "POWERPOINT_RENDERER_REQUEST"
const replyChannel = "POWERPOINT_RENDERER_REPLY"
const bounds = { maxWidth: 1920, maxHeight: 1080, maxPixels: 1920 * 1080 }

app.on("web-contents-created", (_event, contents) => {
    createdContents.push(contents)
    const send = contents.send.bind(contents)
    contents.send = (channel, message, ...args) => {
        if (channel === requestChannel && cancelOnRequest?.operation === message?.operation) {
            const activeCancel = cancelOnRequest
            cancelOnRequest = undefined
            setTimeout(() => activeCancel.controller.abort(), activeCancel.delayMs)
        }
        return send(channel, message, ...args)
    }
})

function makeVariant(outputPath, update) {
    const entries = unzipSync(new Uint8Array(fs.readFileSync(fixturePath)))
    update(entries)
    fs.writeFileSync(outputPath, zipSync(entries, { level: 1 }))
    return outputPath
}

function makeOversizedRaster(outputPath) {
    return makeVariant(outputPath, (entries) => {
        entries["ppt/media/oversized.png"] = fakePng(10_000, 10_000)
    })
}

function makeRenamedRaster(outputPath) {
    return makeVariant(outputPath, (entries) => {
        entries["ppt/media/oversized-image.bin"] = fakePng(10_000, 10_000)
        const contentTypes = new TextDecoder().decode(entries["[Content_Types].xml"])
        entries["[Content_Types].xml"] = strToU8(contentTypes.replace("</Types>", '<Default Extension="bin" ContentType="image/png"/></Types>'))
    })
}

function fakeJpeg(width, height) {
    return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, (height >>> 8) & 0xff, height & 0xff, (width >>> 8) & 0xff, width & 0xff, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9])
}

function makeMislabelledJpeg(outputPath) {
    return makeVariant(outputPath, (entries) => {
        entries["ppt/media/oversized-jpeg.png"] = fakeJpeg(10_000, 10_000)
    })
}

function fakePng(width, height) {
    const png = Buffer.alloc(24)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
    png.writeUInt32BE(13, 8)
    png.write("IHDR", 12, "ascii")
    png.writeUInt32BE(width, 16)
    png.writeUInt32BE(height, 20)
    return png
}

const crcTable = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < table.length; index++) {
        let value = index
        for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
        table[index] = value >>> 0
    }
    return table
})()

function pngCrc32(data) {
    let crc = 0xffffffff
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
    const name = Buffer.from(type, "ascii")
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(pngCrc32(Buffer.concat([name, data])))
    return Buffer.concat([length, name, data, checksum])
}

function solidPng(width, height, color) {
    const rowBytes = width * 3 + 1
    const row = Buffer.alloc(rowBytes)
    for (let offset = 1; offset < rowBytes; offset += 3) {
        row[offset] = color[0]
        row[offset + 1] = color[1]
        row[offset + 2] = color[2]
    }
    const raw = Buffer.alloc(rowBytes * height)
    for (let y = 0; y < height; y++) raw.set(row, y * rowBytes)

    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8
    header[9] = 2
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    return Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw, { level: 1 })), pngChunk("IEND", Buffer.alloc(0))])
}

function makeExactImageBudgetDeck(outputPath, exceedAggregate = false) {
    return makeVariant(outputPath, (entries) => {
        entries["ppt/media/budget-40mp-a.png"] = fakePng(8_000, 5_000)
        entries["ppt/media/budget-40mp-b.png"] = fakePng(8_000, 5_000)
        entries["ppt/media/budget-40mp-c.png"] = fakePng(8_000, 5_000)
        entries["ppt/media/budget-remainder.png"] = fakePng(8_000, 4_999)
        entries["ppt/media/budget-small.png"] = fakePng(1, 7_744)
        if (exceedAggregate) entries["ppt/media/budget-one-over.png"] = fakePng(1, 1)
    })
}

function makeHdImageDeck(outputPath, slideCount = 36) {
    return makeVariant(outputPath, (entries) => {
        const decode = (name) => new TextDecoder().decode(entries[name])
        const presentationPath = "ppt/presentation.xml"
        const presentationRelsPath = "ppt/_rels/presentation.xml.rels"
        const slidePath = "ppt/slides/slide1.xml"
        const slideRelsPath = "ppt/slides/_rels/slide1.xml.rels"
        const contentTypesPath = "[Content_Types].xml"
        const baseSlide = decode(slidePath)
        const baseSlideRels = decode(slideRelsPath)
        const slideIds = []
        const relationships = []
        const overrides = []

        for (let index = 1; index <= slideCount; index++) {
            const slideName = `slide${index}.xml`
            const relsName = `slide${index}.xml.rels`
            const imageName = index === 1 ? "tile.png" : `budget-${index}.png`
            const slideNumber = index - 1
            const image = solidPng(1_920, 1_080, [(41 + index * 31) % 256, (83 + index * 47) % 256, (127 + index * 59) % 256])
            entries[`ppt/media/${imageName}`] = image
            entries[`ppt/slides/${slideName}`] = strToU8(baseSlide.replace("Fixture slide title", `HD image budget slide ${index}`))
            entries[`ppt/slides/_rels/${relsName}`] = strToU8(baseSlideRels.replace("../media/tile.png", `../media/${imageName}`))
            slideIds.push(`<p:sldId id="${256 + slideNumber}" r:id="rId${index + 1}"/>`)
            if (index > 1) relationships.push(`<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${slideName}"/>`)
            if (index > 1) overrides.push(`<Override PartName="/ppt/slides/${slideName}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
        }

        entries[presentationPath] = strToU8(decode(presentationPath).replace(/<p:sldIdLst>.*?<\/p:sldIdLst>/, `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>`))
        entries[presentationRelsPath] = strToU8(decode(presentationRelsPath).replace("</Relationships>", `${relationships.join("")}</Relationships>`))
        entries[contentTypesPath] = strToU8(decode(contentTypesPath).replace("</Types>", `${overrides.join("")}</Types>`))
    })
}

const stockSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" rx="8" fill="#2878a0"/><circle cx="60" cy="40" r="22" fill="#ffffff"/></svg>'

function makeSvgDeck(outputPath, svg = stockSvg) {
    return makeVariant(outputPath, (entries) => {
        const decode = (name) => new TextDecoder().decode(entries[name])
        const slidePath = "ppt/slides/slide1.xml"
        const relsPath = "ppt/slides/_rels/slide1.xml.rels"
        const typesPath = "[Content_Types].xml"
        const picture = '<p:pic><p:nvPicPr><p:cNvPr id="9" name="Stock SVG"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="3657600" y="3657600"/><a:ext cx="1828800" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
        entries["ppt/media/stock.svg"] = Buffer.from(svg)
        entries[slidePath] = strToU8(decode(slidePath).replace("</p:spTree>", `${picture}</p:spTree>`))
        entries[relsPath] = strToU8(decode(relsPath).replace("</Relationships>", '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/stock.svg"/></Relationships>'))
        entries[typesPath] = strToU8(decode(typesPath).replace("</Types>", '<Default Extension="svg" ContentType="image/svg+xml"/></Types>'))
    })
}

function makeOversizedSvg(outputPath) {
    return makeVariant(outputPath, (entries) => {
        entries["ppt/media/oversized.svg"] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" stroke-width="1" data-width="1" width="100000" height="100000"/>')
    })
}

function makeSvgWithOversizedEmbeddedRaster(outputPath) {
    return makeVariant(outputPath, (entries) => {
        const png = Buffer.concat([fakePng(10_000, 10_000), Buffer.from([0])])
        const base64 = png.toString("base64")
        const encoded = `${base64.slice(0, 12)} \n${base64.slice(12).replace(/=+$/, (padding) => padding.replace(/=/g, "%3D"))}`
        entries["ppt/media/embedded-raster.svg"] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><image href="da&#116;a:image/png;base64,${encoded}"/></svg>`)
    })
}

function makeMixedUriSvg(outputPath) {
    return makeVariant(outputPath, (entries) => {
        const benignPng = fakePng(1, 1).toString("base64")
        const nestedSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" stroke-width="1" data-width="1" width="10000" height="10000"/>')
        entries["ppt/media/mixed-uri.svg"] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="data:image/png;base64,${benignPng}"/><image href="data:image/svg+xml,${nestedSvg}"/></svg>`)
    })
}

function makeMixedUnsupportedRasterUriSvg(outputPath) {
    return makeVariant(outputPath, (entries) => {
        const benignPng = fakePng(1, 1).toString("base64")
        entries["ppt/media/mixed-unsupported-uri.svg"] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="data:image/png;base64,${benignPng}"/><image href="data:image/png,AAAA"/></svg>`)
    })
}

function makeLargeOpenDeck(outputPath) {
    const entries = unzipSync(new Uint8Array(fs.readFileSync(fixturePath)))
    entries["ppt/media/unreferenced.bin"] = randomBytes(48 * 1024 * 1024)
    fs.writeFileSync(outputPath, zipSync(entries, { level: 0 }))
    return outputPath
}

function makeSlowSlideDeck(outputPath) {
    return makeVariant(outputPath, (entries) => {
        const slide = new TextDecoder().decode(entries["ppt/slides/slide1.xml"])
        const shape = '<p:sp><p:nvSpPr><p:cNvPr id="42" name="Bounded cancellation shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Safe render</a:t></a:r></a:p></p:txBody></p:sp>'
        entries["ppt/slides/slide1.xml"] = strToU8(slide.replace("</p:spTree>", `${shape.repeat(20_000)}</p:spTree>`))
    })
}

function makeMalformedSlideDeck(outputPath) {
    return makeVariant(outputPath, (entries) => {
        entries["ppt/slides/slide1.xml"] = strToU8("<p:sld><p:cSld><not-closed>")
    })
}

async function expectRejected(action, pattern) {
    let caught
    try {
        await action()
    } catch (error) {
        caught = error
    }
    assert.ok(caught, "expected operation to reject")
    if (pattern) assert.match(String(caught.message || caught), pattern)
}

async function waitFor(check, timeoutMs = 5_000) {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
        if (check()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error("Timed out waiting for the isolated PowerPoint renderer to close")
}

function pngDimensions(buffer) {
    const bytes = new Uint8Array(buffer)
    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
    assert.equal(Buffer.from(bytes.subarray(12, 16)).toString("ascii"), "IHDR")
    const view = new DataView(buffer)
    return { width: view.getUint32(16), height: view.getUint32(20) }
}

function createResourceProbeServer() {
    let requestCount = 0
    const server = http.createServer((_request, response) => {
        requestCount++
        response.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" })
        response.end(Buffer.alloc(24))
    })
    return new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            resolve({
                baseUrl: `http://127.0.0.1:${server.address().port}`,
                get requestCount() {
                    return requestCount
                },
                close: () => new Promise((done) => server.close(done))
            })
        })
    })
}

async function assertRendererResourceIsolation(rendererPid, baseUrl) {
    const renderer = createdContents.find((contents) => !contents.isDestroyed() && contents.getOSProcessId() === rendererPid)
    assert.ok(renderer, "isolated renderer is available for the security probe")
    const contentsBefore = createdContents.length
    const result = await renderer.executeJavaScript(`(async () => {
            const base = ${JSON.stringify(baseUrl)}
            let fetchBlocked = false
            try { await fetch(base + "/fetch") } catch { fetchBlocked = true }
            const imageResult = (source) => new Promise((resolve) => {
                const image = new Image()
                const timer = setTimeout(() => resolve("blocked"), 300)
                image.onload = () => { clearTimeout(timer); resolve("loaded") }
                image.onerror = () => { clearTimeout(timer); resolve("blocked") }
                image.src = source
            })
            const externalImage = await imageResult(base + "/image.png")
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><image href="' + base + '/svg-image.png" width="4" height="4"/></svg>'
            const svgImage = await imageResult("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg))
            const style = document.createElement("style")
            style.textContent = '@font-face { font-family: "BlockedProbe"; src: url("' + base + '/font.woff2"); } body { font-family: "BlockedProbe"; }'
            document.head.append(style)
            await document.fonts.load('16px "BlockedProbe"').catch(() => [])
            const popup = window.open(base + "/popup", "blocked-popup")
            const permission = typeof Notification === "undefined" ? "unsupported" : await Notification.requestPermission().catch(() => "denied")
            const link = document.createElement("a")
            link.href = base + "/navigation"
            document.body.append(link)
            link.click()
            await new Promise((resolve) => setTimeout(resolve, 150))
            return {
                fetchBlocked,
                externalImage,
                svgImage,
                popupBlocked: popup === null,
                permission,
                navigationStayedLocal: location.protocol === "file:"
            }
    })()`)
    assert.equal(result.fetchBlocked, true)
    assert.equal(result.externalImage, "blocked")
    assert.equal(result.svgImage, "loaded", "the inline SVG probe itself should load while its linked image stays blocked")
    assert.equal(result.popupBlocked, true)
    assert.equal(result.permission, "denied")
    assert.equal(result.navigationStayedLocal, true)
    assert.equal(createdContents.length, contentsBefore, "the denied popup did not create another WebContents")
}

async function openAndRender(jobId, sourcePath, uiWindow, afterOpen, pageIndices = [0]) {
    const preflight = await preflightPowerPointArchive(sourcePath)
    const opened = await openPowerPointRenderer({ jobId, sourcePath, uiWebContents: uiWindow.webContents })
    assert.equal(opened.pageCount, preflight.pageCount)
    const pids = getPowerPointRendererPids(jobId)
    assert.ok(pids?.rendererPid)
    assert.ok(pids?.uiPid)
    assert.notEqual(pids.rendererPid, pids.uiPid)
    if (afterOpen) await afterOpen(pids)
    const renderedPages = []
    for (const pageIndex of pageIndices) {
        const page = await renderPowerPointPage(jobId, pageIndex, bounds)
        assert.deepEqual(pngDimensions(page.png), { width: 1440, height: 1080 })
        assert.equal(page.width, 1440)
        assert.equal(page.height, 1080)
        assert.ok(page.png.byteLength > 1_000)
        renderedPages.push({ index: pageIndex, width: page.width, height: page.height, pngBytes: page.png.byteLength })
    }
    const page = renderedPages[0]
    await closePowerPointRenderer(jobId)
    assert.equal(getPowerPointRendererSessionCount(), 0)
    return { ...opened, ...pids, width: page.width, height: page.height, pngBytes: page.pngBytes, renderedPages }
}

async function run() {
    assert.ok(fixturePath && fs.existsSync(fixturePath), "rich PPTX fixture path is required")
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "freeshow-ppt-electron-"))
    const uiWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })

    try {
        await uiWindow.loadURL("data:text/html,<title>FreeShow interactive window</title>")
        const uiPid = uiWindow.webContents.getOSProcessId()
        const resourceServer = await createResourceProbeServer()
        let hostileSvgResult
        try {
            const hostileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><style>@font-face{font-family:RemoteFont;src:url('${resourceServer.baseUrl}/font.woff2')}</style><image href="${resourceServer.baseUrl}/svg-image.png" width="120" height="80"/></svg>`
            const hostileSvgPath = makeSvgDeck(path.join(tempRoot, "hostile-svg.pptx"), hostileSvg)
            hostileSvgResult = await openAndRender("hostile-svg", hostileSvgPath, uiWindow, async (pids) => assertRendererResourceIsolation(pids.rendererPid, resourceServer.baseUrl))
            assert.equal(hostileSvgResult.pageCount, 1)
            await new Promise((resolve) => setTimeout(resolve, 150))
            assert.equal(resourceServer.requestCount, 0, "no HTTP image, SVG, font, fetch, popup, or navigation request reached the local server")
        } finally {
            await resourceServer.close()
        }

        const badZipPath = path.join(tempRoot, "bad.zip.pptx")
        fs.writeFileSync(badZipPath, "not a ZIP archive")
        await expectRejected(() => preflightPowerPointArchive(badZipPath), /archive|central directory|not valid/i)

        const oversizedRasterPath = makeOversizedRaster(path.join(tempRoot, "oversized-raster.pptx"))
        await expectRejected(() => preflightPowerPointArchive(oversizedRasterPath), /40 megapixels/i)

        const exactImageBudgetPath = makeExactImageBudgetDeck(path.join(tempRoot, "exact-image-budget.pptx"))
        const exactImageBudget = await preflightPowerPointArchive(exactImageBudgetPath)
        assert.equal(exactImageBudget.pageCount, 1, "an image at 40 megapixels and an aggregate of exactly 160 megapixels are admitted")

        const overAggregateBudgetPath = makeExactImageBudgetDeck(path.join(tempRoot, "over-aggregate-image-budget.pptx"), true)
        await expectRejected(() => preflightPowerPointArchive(overAggregateBudgetPath), /160 megapixels/i)

        const renamedRasterPath = makeRenamedRaster(path.join(tempRoot, "renamed-raster.pptx"))
        await expectRejected(() => preflightPowerPointArchive(renamedRasterPath), /40 megapixels/i)

        const mislabeledJpegPath = makeMislabelledJpeg(path.join(tempRoot, "mislabeled-jpeg.pptx"))
        await expectRejected(() => preflightPowerPointArchive(mislabeledJpegPath), /40 megapixels/i)

        const stockSvgPath = makeSvgDeck(path.join(tempRoot, "stock-svg.pptx"))
        const stockSvgImport = await openAndRender("stock-svg", stockSvgPath, uiWindow)
        assert.equal(stockSvgImport.pageCount, 1)

        const hdImageDeckPath = makeHdImageDeck(path.join(tempRoot, "36-hd-images.pptx"))
        const hdImageDeckPreflight = await preflightPowerPointArchive(hdImageDeckPath)
        assert.equal(hdImageDeckPreflight.pageCount, 36, "36 distinct full-HD images stay within the 160 megapixel aggregate limit")
        const hdImageDeck = await openAndRender("36-hd-images", hdImageDeckPath, uiWindow, undefined, [0, 17, 35])
        assert.equal(hdImageDeck.pageCount, 36)
        assert.deepEqual(
            hdImageDeck.renderedPages.map((page) => page.index),
            [0, 17, 35],
            "representative full-HD slides render sequentially"
        )

        const oversizedSvgPath = makeOversizedSvg(path.join(tempRoot, "oversized-svg.pptx"))
        await expectRejected(() => preflightPowerPointArchive(oversizedSvgPath), /40 megapixel/i)

        const oversizedEmbeddedSvgPath = makeSvgWithOversizedEmbeddedRaster(path.join(tempRoot, "oversized-svg-raster.pptx"))
        await expectRejected(() => preflightPowerPointArchive(oversizedEmbeddedSvgPath), /40 megapixels/i)

        const mixedUriSvgPath = makeMixedUriSvg(path.join(tempRoot, "mixed-uri-svg.pptx"))
        await expectRejected(() => preflightPowerPointArchive(mixedUriSvgPath), /40 megapixel/i)

        const mixedUnsupportedUriSvgPath = makeMixedUnsupportedRasterUriSvg(path.join(tempRoot, "mixed-unsupported-uri-svg.pptx"))
        await expectRejected(() => preflightPowerPointArchive(mixedUnsupportedUriSvgPath), /non-base64 embedded raster/i)

        const largeOpenDeckPath = makeLargeOpenDeck(path.join(tempRoot, "large-open.pptx"))
        await preflightPowerPointArchive(largeOpenDeckPath)
        const openController = new AbortController()
        cancelOnRequest = { operation: "OPEN", controller: openController, delayMs: 15 }
        await expectRejected(() => openPowerPointRenderer({ jobId: "cancel-open", sourcePath: largeOpenDeckPath, signal: openController.signal, uiWebContents: uiWindow.webContents }), /cancelled/i)
        await waitFor(() => getPowerPointRendererSessionCount() === 0)
        assert.equal(uiWindow.webContents.isDestroyed(), false)
        assert.equal(uiWindow.webContents.getOSProcessId(), uiPid)

        const slowSlidePath = makeSlowSlideDeck(path.join(tempRoot, "slow-slide.pptx"))
        const pageController = new AbortController()
        const slowOpen = await openPowerPointRenderer({ jobId: "cancel-page", sourcePath: slowSlidePath, signal: pageController.signal, uiWebContents: uiWindow.webContents })
        assert.equal(slowOpen.pageCount, 1)
        cancelOnRequest = { operation: "PAGE", controller: pageController, delayMs: 5 }
        await expectRejected(() => renderPowerPointPage("cancel-page", 0, bounds), /cancelled|renderer/i)
        await waitFor(() => getPowerPointRendererSessionCount() === 0)
        assert.equal(uiWindow.webContents.isDestroyed(), false)
        assert.equal(uiWindow.webContents.getOSProcessId(), uiPid)

        const failedSlidePath = makeMalformedSlideDeck(path.join(tempRoot, "malformed-slide.pptx"))
        const failedOpen = await openPowerPointRenderer({ jobId: "failed-page", sourcePath: failedSlidePath, uiWebContents: uiWindow.webContents })
        assert.equal(failedOpen.pageCount, 1)
        await expectRejected(() => renderPowerPointPage("failed-page", 1, bounds), /page index/i)
        await closePowerPointRenderer("failed-page").catch(() => {})
        assert.equal(getPowerPointRendererSessionCount(), 0)

        const next = await openAndRender("after-cancel", fixturePath, uiWindow, (pids) => {
            const hidden = createdContents.find((contents) => contents !== uiWindow.webContents && !contents.isDestroyed() && contents.getOSProcessId() === pids.rendererPid)
            assert.ok(hidden && !hidden.isDestroyed())
            ipcMain.emit(replyChannel, { sender: uiWindow.webContents, senderFrame: uiWindow.webContents.mainFrame }, { operation: "OPEN", requestId: "stale-request", jobToken: "wrong-job-token", result: { pageCount: 999 } })
            ipcMain.emit(replyChannel, { sender: hidden, senderFrame: hidden.mainFrame }, { operation: "OPEN", requestId: "stale-request", jobToken: "wrong-job-token", result: { pageCount: 999 } })
        })
        console.log(
            JSON.stringify({
                status: "passed",
                electron: process.versions.electron,
                chromium: process.versions.chrome,
                pageCount: hostileSvgResult.pageCount,
                output: { width: hostileSvgResult.width, height: hostileSvgResult.height, bytes: hostileSvgResult.pngBytes },
                uiPid,
                rendererPid: hostileSvgResult.rendererPid,
                nextRendererPid: next.rendererPid,
                cancellation: ["OPEN", "PAGE"],
                checks: ["archive rejection", "40MP per-image and 160MP aggregate image limits", "36-image full-HD deck and sequential page rendering", "network/image/SVG/font/navigation/popup/permission isolation", "stale reply ignored", "invalid page cleanup", "next job after cancellation"]
            })
        )
    } finally {
        if (!uiWindow.isDestroyed()) uiWindow.destroy()
        await fs.promises.rm(tempRoot, { recursive: true, force: true })
        app.quit()
    }
}

app.whenReady()
    .then(run)
    .catch((error) => {
        console.error(error)
        app.exit(1)
    })
