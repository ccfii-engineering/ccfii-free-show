import type { ElectronApplication, Page } from "playwright"

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function launchArgs(userDataDir: string, extraArgs: string[] = []) {
    // --no-sandbox is required for Electron to launch reliably on Linux CI.
    return [".", "--no-sandbox", `--user-data-dir=${userDataDir}`, ...extraArgs]
}

export async function findMainWindow(electronApp: ElectronApplication): Promise<Page> {
    for (let attempt = 0; attempt < 30; attempt++) {
        const page = electronApp.windows().find((candidate) => candidate.url().includes("index.html"))
        if (page) return page
        await delay(500)
    }
    throw new Error("Main window did not open")
}

export async function findOutputWindow(electronApp: ElectronApplication, mainWindow: Page): Promise<Page> {
    for (let attempt = 0; attempt < 30; attempt++) {
        for (const candidate of electronApp.windows().filter((page) => page !== mainWindow)) {
            if ((await candidate.locator("[data-output-coordinator]").count()) > 0) return candidate
        }
        await delay(500)
    }
    throw new Error("Presentation Output did not open")
}

export async function finishFirstRun(mainWindow: Page): Promise<void> {
    try {
        await mainWindow.locator(".popup button.start, .top").first().waitFor({ timeout: 20_000 })
    } catch (error) {
        console.log(`Renderer URL: ${mainWindow.url()}`)
        console.log(`Renderer body: ${(await mainWindow.locator("body").innerText()).slice(0, 1000)}`)
        throw error
    }
    const setupStart = mainWindow.locator(".popup button.start")
    let didSetup = false
    if ((await setupStart.count()) > 0) {
        const setupPopup = mainWindow.locator(".popup")
        await setupPopup.locator(".dropdown-trigger").first().click()
        await setupPopup.locator("li[role=option]").filter({ hasText: "English" }).first().click()
        await setupPopup.locator(".button-trigger").first().click()
        await setupStart.click()
        didSetup = true
    }
    const skipGuide = mainWindow.locator("#guideButtons").getByText("Skip")
    if (didSetup) await skipGuide.waitFor({ timeout: 10_000 })
    if ((await skipGuide.count()) > 0) await skipGuide.click()
}

export async function queryAPI(apiUrl: string, action: string, data?: any): Promise<any> {
    // REST bodies are flat: { action, ...params } — triggerAction hands the whole body to the handler
    const response = await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...(data || {}) }) })
    if (!response.ok) throw new Error(`API request failed for ${action}: ${response.status}`)
    const text = await response.text()
    if (!text) return undefined
    return JSON.parse(text).data
}
