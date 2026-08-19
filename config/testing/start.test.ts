import { _electron as electron } from "playwright"
import type { Page } from "playwright"
import { expect, test } from "@playwright/test"
import tmp from "tmp"

const timeoutMs = 2_000
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test.beforeEach(async ({ context }) => {
    await context.route("https://api.github.com/repos/ChurchApps/freeshow/releases", (route) => route.abort())
})

test("Launch electron app", async () => {
    const tmpSettingFolder = tmp.dirSync({ unsafeCleanup: true })
    const gpuRendererErrors: string[] = []
    const electronApp = await electron.launch({
        // --no-sandbox is required for Electron to launch reliably on Linux CI.
        args: [".", "--no-sandbox"],
        env: { ...process.env, NODE_ENV: "production", FS_MOCK_STORE_PATH: tmpSettingFolder.name }
    })
    const attachPageDiagnostics = (page: Page) => {
        page.on("console", (message) => {
            const text = message.text()
            console.log(`[renderer:${message.type()}] ${text}`)
            if (message.type() === "error" && /WebGPUOutput|GPUTextureUsage|GPU backend/i.test(text)) gpuRendererErrors.push(text)
        })
        page.on("pageerror", (error) => {
            const text = error.stack || error.message
            console.log(`[renderer:error] ${text}`)
            if (/WebGPUOutput|GPUTextureUsage|GPU backend/i.test(text)) gpuRendererErrors.push(text)
        })
        page.on("requestfailed", (request) => console.log(`[renderer:requestfailed] ${request.url()} — ${request.failure()?.errorText || "unknown"}`))
    }
    electronApp.on("window", attachPageDiagnostics)
    electronApp.windows().forEach(attachPageDiagnostics)

    // Mocking Electron open dialog
    const tmpDataFolder = tmp.dirSync({ unsafeCleanup: true })
    await electronApp.evaluate(async ({ dialog }, tmpDataFolderName) => {
        dialog.showOpenDialogSync = (): string[] | undefined => {
            return [tmpDataFolderName]
        }
    }, tmpDataFolder.name)

    await electronApp.waitForEvent("window")

    // Seems like we need some delay for FreeShow to start up correctly,
    // before doing anything
    // TODO: would be great if we can identify the loading window and main window
    await delay(5_000)

    const appPath = await electronApp.evaluate(async ({ app }) => {
        // This runs in the main Electron process, parameter here is always
        // the result of the require('electron') in the main app script.
        return app.getAppPath()
    })
    console.log(appPath)

    // The app opens a small loading/splash window first, then the main window.
    // firstWindow() can return the splash, so explicitly pick the main window (it loads index.html).
    let window = electronApp.windows().find((w) => w.url().includes("index.html"))
    for (let i = 0; i < 20 && !window; i++) {
        await delay(500)
        window = electronApp.windows().find((w) => w.url().includes("index.html"))
    }
    if (!window) window = await electronApp.firstWindow()

    // Direct Electron console to Node terminal.
    window.on("console", console.log)
    try {
        // Print the title.
        console.log(await window.title())

        // Capture a screenshot.
        // await window.screenshot({ path: "intro.png" })

        // Wait for the app UI to be interactive: either the first-run setup popup or the main top bar.
        await window
            .locator(".popup button.start, .top")
            .first()
            .waitFor({ timeout: 10 * timeoutMs })

        // First-run setup popup (Initialize.svelte) — only shown when the app isn't initialized yet.
        // It can be absent if a previous run already initialized the user data, so guard it.
        const setupStart = window.locator(".popup button.start")
        let didSetup = false
        if ((await setupStart.count()) > 0) {
            const setupPopup = window.locator(".popup")

            // Set language to English (it is the default, but select it explicitly so the English text selectors below stay stable)
            await setupPopup
                .locator(".dropdown-trigger")
                .first()
                .click({ timeout: 5 * timeoutMs })
            await setupPopup.locator("li[role=option]").filter({ hasText: "English" }).first().click({ timeout: timeoutMs })

            // Set the data location via the folder picker; this triggers the Electron open dialog, mocked above
            await setupPopup.locator(".button-trigger").first().click({ timeout: timeoutMs })

            // Finish setup ("Get started!")
            await setupStart.click({ timeout: timeoutMs })
            didSetup = true
        }

        // skip the onboarding guide (it opens right after a fresh setup; its overlay otherwise intercepts clicks)
        const skipGuide = window.locator("#guideButtons").getByText("Skip")
        if (didSetup) await skipGuide.waitFor({ timeout: 5 * timeoutMs })
        if ((await skipGuide.count()) > 0) await skipGuide.click({ timeout: timeoutMs })

        // Create a new project, then try creating a new show under the project
        await window.getByText("New project").first().click({ timeout: timeoutMs })
        await window.getByText("New show").first().click({ timeout: timeoutMs })

        // Expect the create-show popup to be visible (the name input is part of it)
        await expect(window.locator("#name")).toBeVisible({ timeout: timeoutMs })

        // Fill name of show
        await window.locator("#name").fill("New Test Show", { timeout: timeoutMs })

        // Select category (this will sometimes not have any categories)
        // await window.getByText("—").click()
        // await window.locator("#id_categorysong").click()

        // Put lyrics
        await window.getByText("Quick Lyrics").click({ timeout: timeoutMs })
        let lyricsBox = window.getByPlaceholder("[Verse]")
        await lyricsBox.focus()
        await lyricsBox.fill(`[Verse]\ntest line 1\ntest line 2\n\n[Chorus]\ntest line 3\ntest line 4`, { timeout: timeoutMs })

        // Click new show
        await window.getByTestId("create.show.popup.new.show").click({ timeout: timeoutMs })

        // Try changing group for Chorus (group names render as text in the #group list)
        await window.locator("#group").getByText("Chorus").first().click({ timeout: timeoutMs })
        //await window.getByText("Change group").hover({ timeout: timeoutMs })
        await window
            .locator("#group")
            .getByText("Verse")
            .first()
            .click({ timeout: 5 * timeoutMs })

        // Verify the group changing was successful
        await expect(window.locator("#group").getByText("Verse").first()).toBeVisible({ timeout: timeoutMs })

        // Manual save via keyboard shortcut (Ctrl+S) — robust across menu changes; the app also auto-saves
        await window.keyboard.press("Escape")
        await window.keyboard.press("Control+s")
        await delay(5_000)

        // Regression fixture for the duplicated Presentation Output: the real Electron output
        // must mount one coordinator and one qualified GPU canvas, including after rapid input.
        const outputButton = window.locator("#output_window_button")
        await expect(outputButton).toBeEnabled({ timeout: 5 * timeoutMs })
        await outputButton.click({ timeout: timeoutMs })

        let outputWindow: typeof window | undefined
        for (let attempt = 0; attempt < 20 && !outputWindow; attempt++) {
            await delay(500)
            for (const candidate of electronApp.windows().filter((page) => page !== window)) {
                if ((await candidate.locator("[data-output-coordinator]").count()) > 0) {
                    outputWindow = candidate
                    break
                }
            }
        }
        if (!outputWindow) throw new Error("Presentation Output window did not mount its coordinator")

        const coordinator = outputWindow.locator("[data-output-coordinator]")
        await expect(coordinator).toHaveCount(1)
        await expect(coordinator).toHaveAttribute("data-renderer-mode", "gpu")
        const gpuCanvas = outputWindow.locator("canvas[data-gpu-backend]")
        await expect(gpuCanvas).toHaveCount(1, { timeout: 10 * timeoutMs })
        await expect(gpuCanvas).toHaveAttribute("data-gpu-backend", /webgpu|webgl/)

        await window.keyboard.press("ArrowRight")
        await window.keyboard.press("ArrowRight")
        await window.keyboard.press("ArrowLeft")
        await delay(1_000)
        await expect(coordinator).toHaveCount(1)
        await expect(gpuCanvas).toHaveCount(1)

        const clearAll = window.locator(".clearAll")
        if ((await clearAll.count()) > 0 && (await clearAll.first().isEnabled())) {
            await clearAll.first().click()
            await expect(coordinator).toHaveCount(1)
            await expect(gpuCanvas).toHaveCount(1)
            await window.getByText("Restore output").first().click({ timeout: timeoutMs })
            await expect(coordinator).toHaveCount(1)
            await expect(gpuCanvas).toHaveCount(1)
        }
        expect(gpuRendererErrors).toEqual([])
    } catch (ex) {
        console.log("Taking screenshot")
        console.log((await window.locator("body").innerText()).slice(0, 2000))
        await window.screenshot({ path: "test-output/screenshots/failed.png" })
        const failedProcess = electronApp.process()
        await Promise.race([electronApp.close(), delay(3_000)]).catch(() => undefined)
        if (failedProcess?.pid && !failedProcess.killed) failedProcess.kill("SIGKILL")
        throw ex
    }

    // Close after finishing
    console.log("Closing app...")
    // Race shutdown with a timeout to avoid hanging CI on Linux.
    const electronProcess = electronApp.process()
    await Promise.race([electronApp.close(), delay(5_000)]).catch(() => {})
    try {
        if (electronProcess?.pid && !electronProcess.killed) electronProcess.kill("SIGKILL")
    } catch {
        // already exited
    }
    await delay(1_000)
    console.log("App closed!")

    tmpDataFolder.removeCallback()
    tmpSettingFolder.removeCallback()
    console.log("DONE!")
})
