const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { app, BrowserWindow } = require("electron")
const { preflightPowerPointArchive } = require("./build/electron/data/powerpointArchivePreflight.js")
const { closePowerPointRenderer, getPowerPointRendererPids, openPowerPointRenderer, renderPowerPointPage } = require("./build/electron/data/powerpointRenderer.js")

const fixturePath = process.argv[process.argv.indexOf("--fixture") + 1]
const root = path.join(__dirname, "build/electron")

async function run() {
    assert.ok(fixturePath && fs.existsSync(fixturePath), "PPTX fixture path is required")
    const sitePath = path.join(root, "powerpointRenderer/site/index.html")
    const preloadPath = path.join(root, "powerpointRenderer/preload.js")
    const workerPath = path.join(root, "data/powerpointArchiveWorker.js")
    assert.ok(fs.existsSync(sitePath), "renderer site exists inside app.asar")
    assert.ok(fs.existsSync(preloadPath), "sandbox preload exists inside app.asar")
    assert.ok(fs.existsSync(workerPath), "archive worker exists inside app.asar")

    const preflight = await preflightPowerPointArchive(fixturePath)
    const uiWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
    try {
        await uiWindow.loadURL("data:text/html,<title>FreeShow packaged UI window</title>")
        const opened = await openPowerPointRenderer({ jobId: "packaged-renderer", sourcePath: fixturePath, uiWebContents: uiWindow.webContents })
        const pids = getPowerPointRendererPids("packaged-renderer")
        assert.equal(opened.pageCount, preflight.pageCount)
        assert.ok(pids?.rendererPid && pids?.uiPid)
        assert.notEqual(pids.rendererPid, pids.uiPid)
        const page = await renderPowerPointPage("packaged-renderer", 0, { maxWidth: 1920, maxHeight: 1080, maxPixels: 1920 * 1080 })
        assert.ok(page.png.byteLength > 1_000)
        assert.equal(page.width, 1440)
        assert.equal(page.height, 1080)
        await closePowerPointRenderer("packaged-renderer")
        console.log(JSON.stringify({ status: "passed", packaged: "app.asar", worker: "passed", site: "passed", preload: "passed", uiPid: pids.uiPid, rendererPid: pids.rendererPid }))
    } finally {
        if (!uiWindow.isDestroyed()) uiWindow.destroy()
        app.quit()
    }
}

app.whenReady()
    .then(run)
    .catch((error) => {
        console.error(error)
        app.exit(1)
    })
