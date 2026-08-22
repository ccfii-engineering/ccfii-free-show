import { execFileSync } from "node:child_process"
import path from "node:path"
import { _electron as electron, type Page } from "playwright"
import { expect, test } from "@playwright/test"
import tmp from "tmp"
import { delay, findMainWindow, findOutputWindow, finishFirstRun, launchArgs, playMediaCardUntil, queryAPI, seedWindowConfig, startApiServer } from "./electronTestHelpers"

test("explicit GPU video lifecycle qualification keeps video backgrounds on the GPU renderer", async () => {
    const { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow } = await launchWithVideoFixture()

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
    const { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow } = await launchWithVideoFixture()

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

        // re-read both together so the comparison cannot straddle a publish boundary
        combined = await queryAPI(apiUrl, "get_playing_video_state")
        individualDuration = await queryAPI(apiUrl, "get_playing_video_duration")
        expect(combined.duration, "combined duration agrees with individual").toBe(individualDuration)
        expect(await queryAPI(apiUrl, "get_media_loop_state"), "loop state agrees").toBe(combined.loop)

        // progress advances from the same output state.
        // Seek away from the wrap boundary first so the sample window cannot cross the
        // short fixture's loop point mid-measurement.
        await queryAPI(apiUrl, "video_seekto", { seconds: 0.2 })
        await delay(300)
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

test("GPU playback controls round-trip through the canonical state", async () => {
    const { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow } = await launchWithVideoFixture()

    try {
        await mainWindow.locator("button#media").click()
        await mainWindow.getByText("Add folder", { exact: true }).first().click()
        await mainWindow.getByText(path.basename(dataFolder.name), { exact: true }).first().click()
        await mainWindow.locator('#media.selectElem[data-item*="gpu-loop.webm"]').click()

        const apiPort = 15505
        await mainWindow.evaluate((port) => (window as any).api.send("MAIN", { channel: "WEBSOCKET_START", data: port }), apiPort)
        await delay(250)
        const apiUrl = `http://127.0.0.1:${apiPort + 1}`

        let state: any = {}
        for (let attempt = 0; attempt < 20 && !(state.duration > 1); attempt++) {
            state = await queryAPI(apiUrl, "get_playing_video_state")
            if (!(state.duration > 1)) await delay(250)
        }
        expect(state.duration).toBeGreaterThan(1)

        // PAUSE stops observable progress
        await queryAPI(apiUrl, "toggle_playing_media")
        for (let attempt = 0; attempt < 20 && !state.paused; attempt++) {
            await delay(250)
            state = await queryAPI(apiUrl, "get_playing_video_state")
        }
        expect(state.paused, "pause command reaches the active GPU video").toBe(true)

        // SEEK applies to the visible position and the public snapshot while paused
        await queryAPI(apiUrl, "video_seekto", { seconds: 0.4 })
        await delay(400)
        state = await queryAPI(apiUrl, "get_playing_video_time")
        expect(state, "seek lands near the requested time").toBeGreaterThan(0.25)
        expect(state, "seek lands near the requested time").toBeLessThan(0.6)
        const seekedProgress = state

        // RESUME restarts it
        await queryAPI(apiUrl, "toggle_playing_media")
        let resumed = false
        for (let attempt = 0; attempt < 20 && !resumed; attempt++) {
            await delay(300)
            resumed = (await queryAPI(apiUrl, "get_playing_video_time")) > seekedProgress + 0.05
        }
        expect(resumed, "progress resumes advancing").toBe(true)
        state = await queryAPI(apiUrl, "get_playing_video_state")
        expect(state.paused, "resume clears paused state").toBe(false)

        // MUTE round-trips without transferring ownership (progress keeps flowing).
        // The starting mute state depends on style/media defaults, so assert the toggle
        // flips it and flips back rather than assuming an initial value.
        const muteBefore = (await queryAPI(apiUrl, "get_playing_video_state")).muted
        await queryAPI(apiUrl, "toggle_media_mute")
        await delay(400)
        state = await queryAPI(apiUrl, "get_playing_video_state")
        expect(state.muted, "mute toggles").toBe(!muteBefore)
        await queryAPI(apiUrl, "toggle_media_mute")
        await delay(400)
        state = await queryAPI(apiUrl, "get_playing_video_state")
        expect(state.muted, "second toggle restores mute").toBe(muteBefore)
        expect(state.duration, "ownership unchanged: duration still live").toBeGreaterThan(1)

        // LOOP toggle reflects in public state
        await queryAPI(apiUrl, "toggle_media_loop")
        await delay(400)
        expect(await queryAPI(apiUrl, "get_media_loop_state"), "loop off").toBe(false)
        await queryAPI(apiUrl, "toggle_media_loop")
        await delay(400)
        expect(await queryAPI(apiUrl, "get_media_loop_state"), "loop restored").toBe(true)
    } finally {
        await closeElectron(electronApp)
        dataFolder.removeCallback()
        settingsFolder.removeCallback()
    }
})

test("GPU media replacement keeps a single canonical publisher (#18)", async () => {
    const { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow } = await launchWithVideoFixture()

    try {
        await mainWindow.locator("button#media").click()
        await mainWindow.getByText("Add folder", { exact: true }).first().click()
        await mainWindow.getByText(path.basename(dataFolder.name), { exact: true }).first().click()

        // play video A (1.5s fixture)
        const apiUrl = await startApiServer(mainWindow)
        const state = await playMediaCardUntil(mainWindow, apiUrl, "gpu-loop.webm", (s) => s.duration > 1 && s.duration < 2)
        expect(state.duration, "video A metadata live").toBeGreaterThan(1)

        // replace with video B (3s fixture): only B's metadata/progress may publish afterwards
        const replaced = await playMediaCardUntil(mainWindow, apiUrl, "gpu-second.webm", (s) => s.duration >= 2.5)
        expect(replaced.duration, "video B metadata replaced A's").toBeGreaterThanOrEqual(2.5)

        // anchor away from B's wrap boundary before sampling progress
        await queryAPI(apiUrl, "video_seekto", { seconds: 0.3 })
        await delay(300)
        const before = await queryAPI(apiUrl, "get_playing_video_time")
        await delay(600)
        const after = await queryAPI(apiUrl, "get_playing_video_time")
        expect(after, "only B publishes progress after replacement").toBeGreaterThan(before)
        expect(after, "progress stays inside B's timeline").toBeLessThan(2.5)
    } finally {
        await closeElectron(electronApp)
        dataFolder.removeCallback()
        settingsFolder.removeCallback()
    }
})

test("an unavailable source reaches a bounded failure and a valid source recovers (#18)", async () => {
    const { electronApp, dataFolder, settingsFolder, outputWindow, mainWindow } = await launchWithVideoFixture()

    try {
        await mainWindow.locator("button#media").click()
        await mainWindow.getByText("Add folder", { exact: true }).first().click()
        await mainWindow.getByText(path.basename(dataFolder.name), { exact: true }).first().click()

        // undecodable fixture: indexed like any media file, but the decoder must reject it
        await mainWindow.locator('#media.selectElem[data-item*="gpu-broken.webm"]').click()
        await delay(1500)

        // bounded outcome: renderer survives, and no phantom playback state was published
        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveCount(1)
        await expect(outputWindow.locator("[data-output-coordinator]")).toHaveAttribute("data-renderer-mode", "gpu")
        const apiUrl = await startApiServer(mainWindow)
        const failedState = await queryAPI(apiUrl, "get_playing_video_state")
        expect(failedState.duration, "no stale duration from the failed source").toBe(0)
        expect(failedState.time, "no stale progress from the failed source").toBe(0)

        // recovery: a valid video plays normally in the same session
        const recovered = await playMediaCardUntil(mainWindow, apiUrl, "gpu-loop.webm", (s) => s.duration > 1)
        expect(recovered.duration, "valid video reports duration after a failed source").toBeGreaterThan(1)

        // anchor away from the wrap boundary so the advance window is unambiguous
        await queryAPI(apiUrl, "video_seekto", { seconds: 0.3 })
        await delay(300)
        const before = await queryAPI(apiUrl, "get_playing_video_time")
        await delay(600)
        const after = await queryAPI(apiUrl, "get_playing_video_time")
        expect(after, "valid video advances after a failed source").toBeGreaterThan(before)
        expect(after, "progress stays inside the valid video's timeline").toBeLessThan(recovered.duration)
    } finally {
        await closeElectron(electronApp)
        dataFolder.removeCallback()
        settingsFolder.removeCallback()
    }
})

async function launchWithVideoFixture(extraArgs: string[] = []) {
    const settingsFolder = tmp.dirSync({ unsafeCleanup: true })
    const dataFolder = tmp.dirSync({ unsafeCleanup: true })
    seedWindowConfig(settingsFolder.name)
    const loopMediaPath = path.join(dataFolder.name, "gpu-loop.webm")
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24", "-t", "1.5", "-c:v", "libvpx-vp9", "-an", loopMediaPath])
    const secondMediaPath = path.join(dataFolder.name, "gpu-second.webm")
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24", "-t", "3", "-c:v", "libvpx-vp9", "-an", secondMediaPath])
    // undecodable: correct extension, garbage payload
    execFileSync("dd", ["if=/dev/urandom", `of=${path.join(dataFolder.name, "gpu-broken.webm")}`, "bs=1024", "count=64"])

    const electronApp = await electron.launch({
        args: launchArgs(settingsFolder.name, extraArgs),
        env: { ...process.env, NODE_ENV: "production" }
    })
    electronApp.on("window", (page) => {
        page.on("pageerror", (error) => console.log(`[renderer:error] ${error.stack || error.message}`))
        page.on("console", (message) => console.log(`[renderer:${message.type()}] ${message.text()}`))
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
