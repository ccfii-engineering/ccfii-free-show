import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { _electron as electron, chromium } from "playwright"
import { expect, test } from "@playwright/test"
import tmp from "tmp"
import { delay, findMainWindow, findOutputWindow, finishFirstRun, launchArgs, queryAPI, seedWindowConfig, startApiServer } from "./electronTestHelpers"

const devScript = '<script type="module" src="/src/frontend/main.ts"></script>'
const productionScript = '<script type="module" crossorigin src="./build/bundle.js"></script><link rel="stylesheet" href="./build/bundle.css">'
const remotePort = 5610
const controllerPort = 5612

test("real desktop remote media and ControlShow socket flow", async () => {
    test.setTimeout(180_000)

    const indexPath = path.join(process.cwd(), "public", "index.html")
    const originalIndex = readFileSync(indexPath, "utf8")
    const bundlePath = path.join(process.cwd(), "public", "build", "bundle.js")
    const stylesheetPath = path.join(process.cwd(), "public", "build", "bundle.css")
    if (!existsSync(bundlePath) || !existsSync(stylesheetPath)) throw new Error("Build the production frontend before running Electron UI tests")

    let changedIndex = false
    if (originalIndex.includes(devScript)) {
        writeFileSync(indexPath, originalIndex.replace(devScript, productionScript))
        changedIndex = true
    } else if (!originalIndex.includes(productionScript)) {
        throw new Error("public/index.html does not contain the expected development or production frontend entry")
    }

    const settingsFolder = tmp.dirSync({ unsafeCleanup: true })
    const dataFolder = tmp.dirSync({ unsafeCleanup: true })
    const mediaFolder = tmp.dirSync({ unsafeCleanup: true })
    seedWindowConfig(settingsFolder.name, 1600, 1000)
    const configPath = path.join(settingsFolder.name, "config.json")
    const userConfig = JSON.parse(readFileSync(configPath, "utf8"))
    writeFileSync(configPath, JSON.stringify({ ...userConfig, dataPath: dataFolder.name }))
    mkdirSync(path.join(dataFolder.name, "Config"), { recursive: true })
    writeFileSync(
        path.join(settingsFolder.name, "settings.json"),
        JSON.stringify({
            initialized: true,
            disabledServers: { remote: false, stage: true, controller: false, output_stream: true },
            ports: { remote: remotePort, stage: 5611, controller: controllerPort, output_stream: 5613 },
            maxConnections: 10,
            serverData: {},
            remotePassword: "",
            mediaFolders: { fixture: { name: "Fixture media", icon: "folder", path: mediaFolder.name } }
        })
    )

    const imagePath = path.join(mediaFolder.name, "remote-presenter-fixture.png")
    const videoPath = path.join(mediaFolder.name, "remote-presenter-fixture.webm")
    const audioPath = path.join(mediaFolder.name, "remote-presenter-fixture.mp3")
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=orange:s=320x240", "-frames:v", "1", imagePath])
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24", "-t", "3", "-c:v", "libvpx-vp9", "-an", videoPath])
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-q:a", "9", "-acodec", "libmp3lame", audioPath])

    const electronApp = await electron.launch({ args: launchArgs(settingsFolder.name), env: { ...process.env, NODE_ENV: "production" } })
    const browser = await chromium.launch()
    let remotePage: Awaited<ReturnType<typeof browser.newPage>> | null = null
    let controllerPage: Awaited<ReturnType<typeof browser.newPage>> | null = null

    try {
        await delay(5_000)
        const mainWindow = await findMainWindow(electronApp)
        await finishFirstRun(mainWindow)

        const apiUrl = await startApiServer(mainWindow)
        const outputButton = mainWindow.locator("#output_window_button")
        await expect(outputButton).toBeEnabled()
        await outputButton.click()
        const outputWindow = await findOutputWindow(electronApp, mainWindow)
        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveCount(1)

        const showName = "Remote Presenter IPC Fixture"
        await mainWindow.getByText("New project").first().click()
        await mainWindow.getByText("New show").first().click()
        await mainWindow.locator("#name").fill(showName)
        await mainWindow.getByText("Quick Lyrics").click()
        const lyrics = mainWindow.getByPlaceholder("[Verse]")
        await lyrics.fill("[Verse]\nCurrent slide line\nSecond current line\n\n[Chorus]\nNext slide line")
        await mainWindow.getByTestId("create.show.popup.new.show").click()

        const shows = await queryAPI(apiUrl, "get_shows")
        const showEntry = Object.entries(shows).find(([, value]: [string, any]) => value?.name === showName)
        expect(showEntry, "the desktop created the fixture show").toBeDefined()
        const showId = showEntry![0]
        const show = await queryAPI(apiUrl, "get_show", { id: showId })
        const layoutId = show.settings.activeLayout
        const slideId = show.layouts[layoutId].slides[0].id
        show.slides[slideId].notes = "<p>Desktop note one<br>Desktop note two</p>"
        show.media = { ...show.media, "remote-presenter-image": { path: imagePath, type: "image" } }
        show.slides[slideId].items.push({
            id: "remote-presenter-image",
            type: "media",
            src: "remote-presenter-image",
            style: "left: 1200px; top: 500px; width: 400px; height: 300px;",
            fit: "contain"
        })
        await queryAPI(apiUrl, "set_show", { id: showId, value: JSON.stringify(show) })
        await queryAPI(apiUrl, "start_show", { id: showId })

        await expect
            .poll(async () => {
                try {
                    const [remote, controller] = await Promise.all([fetch(`http://127.0.0.1:${remotePort}`), fetch(`http://127.0.0.1:${controllerPort}`)])
                    return [remote.status, controller.status]
                } catch {
                    return [0, 0]
                }
            })
            .toEqual([200, 200])

        remotePage = await browser.newPage({ viewport: { width: 390, height: 844 } })
        await remotePage.goto(`http://127.0.0.1:${remotePort}`)
        await expect(remotePage.locator(".tabs button[title='Media']")).toBeVisible({ timeout: 20_000 })
        await remotePage.locator(".tabs button[title='Media']").click()
        const mediaRoot = remotePage.locator(".media-entry").filter({ hasText: "Fixture media" })
        await expect(mediaRoot).toBeVisible({ timeout: 5_000 })
        await mediaRoot.click()
        await expect(remotePage.locator(".media-entry").filter({ hasText: path.basename(imagePath) })).toBeVisible()
        await expect(remotePage.locator(".media-entry").filter({ hasText: path.basename(videoPath) })).toBeVisible()
        await expect(remotePage.locator(".media-entry").filter({ hasText: path.basename(audioPath) })).toBeVisible()
        await expect(remotePage.locator(".media-entry img").first()).toHaveAttribute("src", /^data:image\//)

        controllerPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        await controllerPage.goto(`http://127.0.0.1:${controllerPort}`)
        await expect(controllerPage.locator(".preview-panel").first()).toContainText("Current slide line", { timeout: 20_000 })
        await expect(controllerPage.locator(".preview-panel").nth(1)).toContainText("Next slide line")
        await expect(controllerPage.locator(".presenter-notes p")).toContainText("Desktop note one")
        await expect(controllerPage.locator(".presenter-notes p")).toContainText("Desktop note two")
        await expect(controllerPage.locator(".preview-panel .item img").first()).toHaveAttribute("src", /^data:image\//)

        await remotePage
            .locator(".media-entry")
            .filter({ hasText: path.basename(imagePath) })
            .click()
        await expect.poll(async () => (await queryAPI(apiUrl, "get_output"))?.background?.path).toBe(imagePath)
        await remotePage
            .locator(".media-entry")
            .filter({ hasText: path.basename(videoPath) })
            .click()
        await expect.poll(async () => (await queryAPI(apiUrl, "get_output"))?.background?.path).toBe(videoPath)
        await remotePage
            .locator(".media-entry")
            .filter({ hasText: path.basename(audioPath) })
            .click()
        await expect(remotePage.locator(".media-library [role='status']")).toHaveText("Sent to the output.")
    } finally {
        await remotePage?.close().catch(() => undefined)
        await controllerPage?.close().catch(() => undefined)
        await browser.close().catch(() => undefined)
        const process = electronApp.process()
        await Promise.race([electronApp.close(), delay(5_000)]).catch(() => undefined)
        if (process?.pid && !process.killed) process.kill("SIGKILL")
        dataFolder.removeCallback()
        mediaFolder.removeCallback()
        settingsFolder.removeCallback()
        if (changedIndex) writeFileSync(indexPath, originalIndex)
    }
})
