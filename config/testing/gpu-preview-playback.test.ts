import { execFileSync } from "node:child_process"
import path from "node:path"
import { _electron as electron } from "playwright"
import { expect, test } from "@playwright/test"
import tmp from "tmp"
import { delay, findMainWindow, findOutputWindow, finishFirstRun, launchArgs, seedWindowConfig } from "./electronTestHelpers"

test("mirrored preview follows GPU video playback controls", async () => {
    test.setTimeout(120_000)
    const settingsFolder = tmp.dirSync({ unsafeCleanup: true })
    const dataFolder = tmp.dirSync({ unsafeCleanup: true })
    seedWindowConfig(settingsFolder.name, 1280, 960)

    const fixtureName = "gpu-preview-sync.webm"
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24", "-t", "8", "-c:v", "libvpx-vp9", "-an", path.join(dataFolder.name, fixtureName)])

    const electronApp = await electron.launch({
        args: launchArgs(settingsFolder.name),
        env: { ...process.env, NODE_ENV: "production" }
    })

    try {
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
        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveAttribute("data-renderer-mode", "gpu")

        await mainWindow.locator("button#media").click()
        await mainWindow.getByText("Add folder", { exact: true }).first().click()
        await mainWindow.getByText(path.basename(dataFolder.name), { exact: true }).first().click()
        await mainWindow.locator(`#media.selectElem[data-item*="${fixtureName}"]`).click()

        const operatorSeek = mainWindow.locator('#previewArea [data-testid="video-seek"] input[type=range]')
        const previewVideo = mainWindow.locator("#previewArea .previewOutput video").first()
        await expect(previewVideo).toBeVisible({ timeout: 15_000 })
        await expect.poll(async () => Number(await operatorSeek.getAttribute("max")), { message: "GPU duration reaches operator controls" }).toBeGreaterThan(1)
        await expect.poll(async () => Number(await operatorSeek.inputValue()), { message: "GPU progress reaches operator controls" }).toBeGreaterThan(0.2)

        await expect.poll(async () => await previewVideo.evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime })), { message: "mirrored preview plays the selected GPU video" }).toMatchObject({ paused: false, time: expect.any(Number) })
        await expect.poll(async () => await previewVideo.evaluate((video: HTMLVideoElement) => video.currentTime), { message: "mirrored preview time advances" }).toBeGreaterThan(0.2)

        await mainWindow.locator('#previewArea button[data-title="Pause"]').click()
        await expect.poll(async () => await previewVideo.evaluate((video: HTMLVideoElement) => video.paused), { message: "mirrored preview pauses" }).toBe(true)
        const pausedAt = await previewVideo.evaluate((video: HTMLVideoElement) => video.currentTime)
        await delay(400)
        expect(Math.abs((await previewVideo.evaluate((video: HTMLVideoElement) => video.currentTime)) - pausedAt), "mirrored preview remains paused").toBeLessThan(0.08)

        const seekTarget = 4
        await operatorSeek.fill(String(seekTarget))
        await operatorSeek.dispatchEvent("change")
        await expect.poll(async () => Math.abs((await previewVideo.evaluate((video: HTMLVideoElement) => video.currentTime)) - seekTarget), { message: "mirrored preview seeks with GPU playback" }).toBeLessThan(0.25)

        await mainWindow.locator('#previewArea button[data-title="Play"]').click()
        await expect.poll(async () => await previewVideo.evaluate((video: HTMLVideoElement) => video.paused), { message: "mirrored preview resumes" }).toBe(false)
        const resumedAt = await previewVideo.evaluate((video: HTMLVideoElement) => video.currentTime)
        await expect.poll(async () => (await previewVideo.evaluate((video: HTMLVideoElement) => video.currentTime)) - resumedAt, { message: "mirrored preview advances after resume" }).toBeGreaterThan(0.08)
    } finally {
        const process = electronApp.process()
        await Promise.race([electronApp.close(), delay(3_000)]).catch(() => undefined)
        if (process?.pid && !process.killed) process.kill("SIGKILL")
        dataFolder.removeCallback()
        settingsFolder.removeCallback()
    }
})
