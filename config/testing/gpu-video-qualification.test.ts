import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { _electron as electron } from "playwright"
import { expect, test } from "@playwright/test"
import tmp from "tmp"
import { delay, findMainWindow, findOutputWindow, finishFirstRun, launchArgs, playMediaCardUntil, queryAPI, seedWindowConfig, startApiServer } from "./electronTestHelpers"

// GPU video lifecycle qualification (#19). Distinct from graphics-backend initialization: a
// passing WebGPU/WebGL canvas says nothing about the media contract. This suite drives the real
// Electron seam — operator selection, Presentation Output rendering, playback controls, and the
// public REST endpoints — and records an explicit per-capability result. Default GPU video
// routing is only allowed because this suite passes; any failure here is a release blocker for
// the routing decision, not just a red test.

const CLIP_SECONDS = "2"

// Formats the bundled Chromium runtime is expected to decode in CI.
const SUPPORTED_FORMATS = [
    { id: "webm-vp9", file: "qual-webm-vp9.webm", ffargs: ["-c:v", "libvpx-vp9"], fullContract: true },
    { id: "mp4-h264", file: "qual-mp4-h264.mp4", ffargs: ["-c:v", "libx264", "-pix_fmt", "yuv420p"], fullContract: false },
    { id: "mkv-h264", file: "qual-mkv-h264.mkv", ffargs: ["-c:v", "libx264", "-pix_fmt", "yuv420p"], fullContract: false },
    { id: "mov-h264", file: "qual-mov-h264.mov", ffargs: ["-c:v", "libx264", "-pix_fmt", "yuv420p"], fullContract: false },
    { id: "webm-vp8", file: "qual-webm-vp8.webm", ffargs: ["-c:v", "libvpx"], fullContract: false }
]

// Container/codec combination Chromium cannot demux or decode: must produce a deterministic
// safe-fallback (bounded skip, no phantom playback state) instead of a crash or retry storm.
const UNSUPPORTED_FORMAT = { id: "avi-msmpeg4", file: "qual-avi-msmpeg4.avi", ffargs: ["-c:v", "msmpeg4v3"] }

test("GPU video lifecycle qualification across supported formats (#19)", async () => {
    test.setTimeout(300_000)
    const settingsFolder = tmp.dirSync({ unsafeCleanup: true })
    const dataFolder = tmp.dirSync({ unsafeCleanup: true })
    seedWindowConfig(settingsFolder.name)

    const fixtureFiles: string[] = []
    for (const format of [...SUPPORTED_FORMATS, UNSUPPORTED_FORMAT]) {
        const filePath = path.join(dataFolder.name, format.file)
        execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24", "-t", CLIP_SECONDS, ...format.ffargs, "-an", filePath])
        fixtureFiles.push(format.file)
    }

    const electronApp = await electron.launch({
        args: launchArgs(settingsFolder.name),
        env: { ...process.env, NODE_ENV: "production" }
    })
    electronApp.on("window", (page) => {
        page.on("pageerror", (error) => console.log(`[renderer:error] ${error.stack || error.message}`))
        page.on("console", (message) => console.log(`[renderer:${message.type()}] ${message.text()}`))
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
        const coordinator = outputWindow.locator("[data-output-coordinator]")

        // default routing: qualified GPU video needs no special launch flags (#19)
        await expect(coordinator).toHaveAttribute("data-renderer-mode", "gpu")
        const apiUrl = await startApiServer(mainWindow)

        // index the fixture folder through the operator flow
        await mainWindow.locator("button#media").click()
        await mainWindow.getByText("Add folder", { exact: true }).first().click()
        await mainWindow.getByText(path.basename(dataFolder.name), { exact: true }).first().click()
        const anyCard = mainWindow.locator("#media.selectElem").first()
        await expect(anyCard).toBeVisible({ timeout: 15_000 })

        const results: Record<string, any> = {
            backendInitRequiredForQualification: false,
            formats: {},
            controls: {},
            fallback: {},
            cleanup: {},
            shutdown: {}
        }

        // UNSUPPORTED FIRST: deterministic safe-fallback before anything else runs
        await mainWindow.locator(`#media.selectElem[data-item*="${UNSUPPORTED_FORMAT.file}"]`).click()
        await delay(2500)
        results.fallback.unsupported = {
            rendererMode: await coordinator.getAttribute("data-renderer-mode"),
            phantomDuration: await queryAPI(apiUrl, "get_playing_video_duration"),
            phantomProgress: await queryAPI(apiUrl, "get_playing_video_time")
        }
        expect(results.fallback.unsupported.rendererMode, "unsupported codec stays on the GPU renderer (bounded skip)").toBe("gpu")
        expect(results.fallback.unsupported.phantomDuration, "no phantom duration from unsupported source").toBe(0)
        expect(results.fallback.unsupported.phantomProgress, "no phantom progress from unsupported source").toBe(0)

        // SUPPORTED FORMATS: live metadata + advancing progress (+ wrap observation where marked)
        for (const [index, format] of SUPPORTED_FORMATS.entries()) {
            const state = await playMediaCardUntil(mainWindow, apiUrl, format.file, (s) => s.duration > 1 && s.duration < 3)
            expect(state.duration, `${format.id} reports live duration`).toBeGreaterThan(1)

            // anchor away from the wrap boundary, then require monotonic advance
            await queryAPI(apiUrl, "video_seekto", { seconds: 0.3 })
            await delay(300)
            const before = await queryAPI(apiUrl, "get_playing_video_time")
            await delay(500)
            const after = await queryAPI(apiUrl, "get_playing_video_time")
            expect(after, `${format.id} progress advances`).toBeGreaterThan(before)

            const entry: Record<string, any> = { duration: state.duration, advanced: true }

            if (index < 2) {
                // wrap qualification: park near the end of a looping clip and observe the reset
                const duration = await queryAPI(apiUrl, "get_playing_video_duration")
                await queryAPI(apiUrl, "video_seekto", { seconds: Math.max(0.1, duration - 0.25) })
                let wrapped = false
                for (let poll = 0; poll < 24 && !wrapped; poll++) {
                    await delay(150)
                    const t = await queryAPI(apiUrl, "get_playing_video_time")
                    if (t < before && t > 0.01) wrapped = true
                }
                entry.wrapped = wrapped
                expect(wrapped, `${format.id} loop wrap is observable and playback continues`).toBe(true)
            }

            results.formats[format.id] = entry
        }

        // FULL OPERATOR CONTRACT on the primary format
        const primary = SUPPORTED_FORMATS[0]
        await playMediaCardUntil(mainWindow, apiUrl, primary.file, () => true, 1)

        const operatorSeek = mainWindow.locator('#previewArea [data-testid="video-seek"] input[type=range]')
        await expect(operatorSeek).toBeVisible()
        await expect.poll(async () => Number(await operatorSeek.getAttribute("max")), { message: "operator controls receive live duration" }).toBeGreaterThan(1)
        await expect.poll(async () => Number(await operatorSeek.inputValue()), { message: "operator seek position advances", intervals: [100] }).toBeGreaterThan(0)

        await mainWindow.locator('#previewArea button[data-title="Pause"]').click()
        await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_state")).paused, { message: "operator pause reaches the active video" }).toBe(true)
        const pausedAnchor = await queryAPI(apiUrl, "get_playing_video_time")
        await delay(400)
        expect(Math.abs((await queryAPI(apiUrl, "get_playing_video_time")) - pausedAnchor), "operator pause holds canonical progress").toBeLessThan(0.08)

        const operatorSeekTarget = pausedAnchor >= 0.5 ? 0 : 1
        expect(Math.abs(pausedAnchor - operatorSeekTarget), "seek target differs from the paused position").toBeGreaterThan(0.4)
        await operatorSeek.fill(String(operatorSeekTarget))
        await operatorSeek.dispatchEvent("change")
        await expect.poll(async () => Math.abs((await queryAPI(apiUrl, "get_playing_video_time")) - operatorSeekTarget), { message: "operator seek reaches the requested position" }).toBeLessThan(0.2)

        await mainWindow.locator('#previewArea button[data-title="Play"]').click()
        await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_state")).paused, { message: "operator resume reaches the active video" }).toBe(false)
        const operatorResumeAnchor = await queryAPI(apiUrl, "get_playing_video_time")
        await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_time")) - operatorResumeAnchor, { message: "operator resume restarts canonical progress" }).toBeGreaterThan(0.08)

        await queryAPI(apiUrl, "toggle_playing_media") // pause through API
        let pausedState: any = {}
        for (let attempt = 0; attempt < 16 && pausedState.paused !== true; attempt++) {
            await delay(200)
            pausedState = await queryAPI(apiUrl, "get_playing_video_state")
        }
        expect(pausedState.paused, "pause stops the active video").toBe(true)

        await queryAPI(apiUrl, "video_seekto", { seconds: 0.3 })
        await delay(300)
        const resumeAnchor = await queryAPI(apiUrl, "get_playing_video_time")
        await queryAPI(apiUrl, "toggle_playing_media") // resume
        let resumed = false
        for (let attempt = 0; attempt < 16 && !resumed; attempt++) {
            await delay(250)
            resumed = (await queryAPI(apiUrl, "get_playing_video_time")) > resumeAnchor + 0.05
        }
        expect(resumed, "resume restarts progress").toBe(true)

        const muteBefore = (await queryAPI(apiUrl, "get_playing_video_state")).muted
        await queryAPI(apiUrl, "toggle_media_mute")
        let mutedNow: any = null
        for (let attempt = 0; attempt < 16 && mutedNow !== !muteBefore; attempt++) {
            await delay(250)
            mutedNow = (await queryAPI(apiUrl, "get_playing_video_state")).muted
        }
        expect(mutedNow, "mute toggles").toBe(!muteBefore)
        await queryAPI(apiUrl, "toggle_media_mute")
        let restored: any = null
        for (let attempt = 0; attempt < 16 && restored !== muteBefore; attempt++) {
            await delay(250)
            restored = (await queryAPI(apiUrl, "get_playing_video_state")).muted
        }
        expect(restored, "second toggle restores mute").toBe(muteBefore)

        const operatorMuteBefore = (await queryAPI(apiUrl, "get_playing_video_state")).muted
        await mainWindow.locator(`#previewArea button[data-title="${operatorMuteBefore ? "Unmute" : "Mute"}"]`).click()
        await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_state")).muted, { message: "operator mute reaches the active video" }).toBe(!operatorMuteBefore)
        await mainWindow.locator(`#previewArea button[data-title="${operatorMuteBefore ? "Mute" : "Unmute"}"]`).click()
        await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_state")).muted, { message: "operator mute can be restored" }).toBe(operatorMuteBefore)

        const operatorLoopBefore = (await queryAPI(apiUrl, "get_playing_video_state")).loop
        const operatorLoop = mainWindow.locator('#previewArea button[data-title^="Loop"]')
        await operatorLoop.click()
        await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_state")).loop, { message: "operator loop reaches the active video" }).toBe(!operatorLoopBefore)
        await expect(operatorLoop).toHaveAttribute("data-title", operatorLoopBefore ? "Loop" : "Loop: Enabled")
        await operatorLoop.click()
        await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_state")).loop, { message: "operator loop can be restored" }).toBe(operatorLoopBefore)
        await expect(operatorLoop).toHaveAttribute("data-title", operatorLoopBefore ? "Loop: Enabled" : "Loop")

        if (!operatorLoopBefore) {
            await operatorLoop.click()
            await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_state")).loop, { message: "operator enables loop for wrap qualification" }).toBe(true)
        }
        const loopDuration = await queryAPI(apiUrl, "get_playing_video_duration")
        await queryAPI(apiUrl, "video_seekto", { seconds: loopDuration - 0.2 })
        let operatorLoopWrapped = false
        let operatorLoopWrappedAt = 0
        for (let attempt = 0; attempt < 20 && !operatorLoopWrapped; attempt++) {
            await delay(150)
            operatorLoopWrappedAt = await queryAPI(apiUrl, "get_playing_video_time")
            operatorLoopWrapped = operatorLoopWrappedAt > 0.01 && operatorLoopWrappedAt < 0.4
        }
        expect(operatorLoopWrapped, "operator-enabled loop wraps to a positive position").toBe(true)
        await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_time")) - operatorLoopWrappedAt, { message: "operator-enabled loop continues after wrapping" }).toBeGreaterThan(0.05)
        if (!operatorLoopBefore) {
            await operatorLoop.click()
            await expect.poll(async () => (await queryAPI(apiUrl, "get_playing_video_state")).loop, { message: "operator loop is restored after wrap qualification" }).toBe(false)
        }
        results.controls = { pause: true, resume: true, seek: true, mute: true, loop: true }

        // CLEAR CLEANUP through the public contract
        await queryAPI(apiUrl, "clear_background")
        await delay(600)
        results.cleanup = {
            duration: await queryAPI(apiUrl, "get_playing_video_duration"),
            progress: await queryAPI(apiUrl, "get_playing_video_time")
        }
        expect(results.cleanup.duration, "clear resets canonical duration").toBe(0)
        expect(results.cleanup.progress, "clear resets canonical progress").toBe(0)

        // SHUTDOWN: closing the Presentation Output releases playback ownership cleanly
        await playMediaCardUntil(mainWindow, apiUrl, primary.file, (s) => s.duration > 1)
        await outputButton.click() // toggle off
        let afterClose = 0
        for (let attempt = 0; attempt < 12 && afterClose !== 0; attempt++) {
            await delay(250)
            afterClose = await queryAPI(apiUrl, "get_playing_video_duration")
        }
        expect(afterClose, "closing the output releases playback state").toBe(0)
        // the stored background is cleared asynchronously alongside canonical state (#19)
        let clearedOut: any = {}
        for (let attempt = 0; attempt < 16 && clearedOut.background; attempt++) {
            await delay(250)
            clearedOut = await queryAPI(apiUrl, "get_output")
        }
        expect(clearedOut?.background ?? null, "closing clears the stored background").toBe(null)

        // reopening mounts a healthy GPU coordinator again (fresh playback generation)
        await outputButton.click() // toggle back on
        await delay(1500)
        await expect(coordinator).toHaveCount(1)
        await expect(coordinator).toHaveAttribute("data-renderer-mode", "gpu")
        results.shutdown = { closed: true, stateReleased: true, reopenedHealthy: true }

        // explicit, machine-readable qualification result (distinct from backend init status)
        const outDir = path.join(process.cwd(), "test-output")
        mkdirSync(outDir, { recursive: true })
        writeFileSync(path.join(outDir, "gpu-video-qualification.json"), JSON.stringify({ passed: true, ...results }, null, 2))
    } finally {
        const process = electronApp.process()
        await Promise.race([electronApp.close(), delay(3_000)]).catch(() => undefined)
        if (process?.pid && !process.killed) process.kill("SIGKILL")
        dataFolder.removeCallback()
        settingsFolder.removeCallback()
    }
})
