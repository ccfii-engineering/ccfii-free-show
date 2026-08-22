import { execFileSync } from "node:child_process"
import path from "node:path"
import { _electron as electron } from "playwright"
import { expect, test } from "@playwright/test"
import tmp from "tmp"
import { delay, findMainWindow, findOutputWindow, finishFirstRun, launchArgs, queryAPI } from "./electronTestHelpers"

test("default video playback uses the safe renderer with live duration, progress, and looping", async () => {
    const { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow } = await launchWithVideoFixture()

    try {
        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveAttribute("data-renderer-mode", "gpu")

        await mainWindow.locator("button#media").click()
        await mainWindow.getByText("Add folder", { exact: true }).first().click()
        await mainWindow.getByText(path.basename(dataFolder.name), { exact: true }).first().click()
        const loopMediaCard = mainWindow.locator('#media.selectElem[data-item*="gpu-loop.webm"]')
        await expect(loopMediaCard).toHaveCount(1)

        await loopMediaCard.click()

        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveAttribute("data-renderer-mode", "legacy-fallback")

        const video = outputWindow.locator('video[src*="gpu-loop.webm"]')
        await expect(video).toHaveCount(1, { timeout: 10_000 })
        await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(1)
        await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.25)
        await expect(video).toHaveJSProperty("loop", true)

        const apiPort = 15505
        await mainWindow.evaluate((port) => (window as any).api.send("MAIN", { channel: "WEBSOCKET_START", data: port }), apiPort)
        await delay(250)
        const apiUrl = `http://127.0.0.1:${apiPort + 1}`
        const state = await queryAPI(apiUrl, "get_playing_video_state")
        const duration = await queryAPI(apiUrl, "get_playing_video_duration")
        const progress = await queryAPI(apiUrl, "get_playing_video_time")
        const loop = await queryAPI(apiUrl, "get_media_loop_state")
        expect.soft(state.duration, "combined state duration").toBeGreaterThan(1)
        expect.soft(duration, "established duration endpoint").toBeGreaterThan(1)
        expect.soft(progress, "established progress endpoint").toBeGreaterThan(0.25)
        expect.soft(loop, "loop state endpoint").toBe(true)

        await delay(2_000)
        const currentTimeAfterWrap = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
        expect(currentTimeAfterWrap).toBeGreaterThan(0)
        expect(currentTimeAfterWrap).toBeLessThan(1.5)
    } finally {
        await closeElectron(electronApp)
        dataFolder.removeCallback()
        settingsFolder.removeCallback()
    }
})

test("explicit GPU video lifecycle qualification keeps video backgrounds on the GPU renderer", async () => {
    const { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow } = await launchWithVideoFixture(["--gpu-video-lifecycle-qualified"])

    try {
        // the qualification switch must be reachable end-to-end so tests/development can exercise
        // GPU video rendering before it becomes the default again (#15)
        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveAttribute("data-renderer-mode", "gpu")

        await mainWindow.locator("button#media").click()
        await mainWindow.getByText("Add folder", { exact: true }).first().click()
        await mainWindow.getByText(path.basename(dataFolder.name), { exact: true }).first().click()
        const loopMediaCard = mainWindow.locator('#media.selectElem[data-item*="gpu-loop.webm"]')
        await expect(loopMediaCard).toHaveCount(1)

        await loopMediaCard.click()

        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveAttribute("data-renderer-mode", "gpu")
        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveCount(1)
    } finally {
        await closeElectron(electronApp)
        dataFolder.removeCallback()
        settingsFolder.removeCallback()
    }
})

test("GPU video publishes one canonical snapshot to all public endpoints and resets when cleared", async () => {
    const { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow } = await launchWithVideoFixture(["--gpu-video-lifecycle-qualified"])

    try {
        await mainWindow.locator("button#media").click()
        await mainWindow.getByText("Add folder", { exact: true }).first().click()
        await mainWindow.getByText(path.basename(dataFolder.name), { exact: true }).first().click()
        const loopMediaCard = mainWindow.locator('#media.selectElem[data-item*="gpu-loop.webm"]')
        await expect(loopMediaCard).toHaveCount(1)

        await loopMediaCard.click()

        const video = outputWindow.locator('video[src*="gpu-loop.webm"]')
        await expect(video).toHaveCount(1, { timeout: 10_000 })

        const apiPort = 15505
        await mainWindow.evaluate((port) => (window as any).api.send("MAIN", { channel: "WEBSOCKET_START", data: port }), apiPort)
        await delay(250)
        const apiUrl = `http://127.0.0.1:${apiPort + 1}`

        // combined and individual endpoints must agree on the canonical snapshot (#16)
        let combined: any
        let individualDuration = 0
        for (let attempt = 0; attempt < 20 && individualDuration <= 1; attempt++) {
            combined = await queryAPI(apiUrl, "get_playing_video_state")
            individualDuration = await queryAPI(apiUrl, "get_playing_video_duration")
            if (individualDuration <= 1) await delay(250)
        }
        expect(individualDuration, "established duration endpoint").toBeGreaterThan(1)
        expect(combined.duration, "combined duration agrees with individual").toBe(individualDuration)
        expect(await queryAPI(apiUrl, "get_media_loop_state"), "loop state agrees").toBe(combined.loop)

        // progress advances from the same output-scoped state
        const progressA = await queryAPI(apiUrl, "get_playing_video_time")
        await delay(600)
        const progressB = await queryAPI(apiUrl, "get_playing_video_time")
        expect(progressB, "progress advances").toBeGreaterThan(progressA)

        // clearing media removes stale duration and progress (#16 reset contract)
        await queryAPI(apiUrl, "clear_background")
        await delay(500)
        expect(await queryAPI(apiUrl, "get_playing_video_duration")).toBe(0)
        expect(await queryAPI(apiUrl, "get_playing_video_time")).toBe(0)
        expect((await queryAPI(apiUrl, "get_playing_video_state")).duration).toBe(0)
    } finally {
        await closeElectron(electronApp)
        dataFolder.removeCallback()
        settingsFolder.removeCallback()
    }
})

async function launchWithVideoFixture(extraArgs: string[] = []) {
    const settingsFolder = tmp.dirSync({ unsafeCleanup: true })
    const dataFolder = tmp.dirSync({ unsafeCleanup: true })
    const loopMediaPath = path.join(dataFolder.name, "gpu-loop.webm")
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24", "-t", "1.5", "-c:v", "libvpx-vp9", "-an", loopMediaPath])

    const electronApp = await electron.launch({
        args: launchArgs(settingsFolder.name, extraArgs),
        env: { ...process.env, NODE_ENV: "production" }
    })
    electronApp.on("window", (page) => {
        page.on("pageerror", (error) => console.log(`[renderer:error] ${error.stack || error.message}`))
    })

    await electronApp.evaluate(async ({ dialog }, selectedFolder) => {
        dialog.showOpenDialogSync = (): string[] => [selectedFolder]
    }, dataFolder.name)

    await delay(5_000)
    const mainWindow = await findMainWindow(electronApp)
    await finishFirstRun(mainWindow)

    const outputButton = mainWindow.locator("#output_window_button")
    await expect(outputButton).toBeEnabled()
    await outputButton.click()
    const outputWindow = await findOutputWindow(electronApp, mainWindow)

    return { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow }
}

async function closeElectron(electronApp: Awaited<ReturnType<typeof electron.launch>>) {
    const process = electronApp.process()
    await Promise.race([electronApp.close(), delay(3_000)]).catch(() => undefined)
    if (process?.pid && !process.killed) process.kill("SIGKILL")
}
