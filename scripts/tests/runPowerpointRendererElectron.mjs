import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createPackage } from "@electron/asar"
import electronPath from "electron"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const testApp = path.join(root, "scripts/tests/powerpoint-renderer-electron")
const fixture = path.join(root, "scripts/tests/fixtures/powerpoint-renderer-rich.pptx")
const useXvfb = process.platform === "linux" && !process.env.DISPLAY && existsSync("/usr/bin/xvfb-run")

function runElectronApp(appPath) {
    const args = [appPath, "--no-sandbox", "--fixture", fixture]
    const command = useXvfb ? "/usr/bin/xvfb-run" : electronPath
    const commandArgs = useXvfb ? ["-a", electronPath, ...args] : args
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, { cwd: root, stdio: "inherit", env: process.env })
        child.once("error", reject)
        child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })
}

async function makeAsarTestApp() {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "freeshow-ppt-asar-"))
    const appRoot = path.join(tempRoot, "app")
    const electronBuild = path.join(root, "build/electron")
    await mkdir(path.join(appRoot, "build/electron/data"), { recursive: true })
    await cp(path.join(testApp, "asar-main.cjs"), path.join(appRoot, "main.cjs"))
    await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "freeshow-ppt-asar-runtime", version: "1.0.0", main: "main.cjs" }))

    for (const file of ["data/powerpointRenderer.js", "data/powerpointArchivePreflight.js", "data/powerpointArchiveWorker.js"]) {
        await cp(path.join(electronBuild, file), path.join(appRoot, "build/electron", file))
    }
    await cp(path.join(electronBuild, "powerpointRenderer"), path.join(appRoot, "build/electron/powerpointRenderer"), { recursive: true })

    for (const dependency of ["yauzl", "pend", "buffer-crc32"]) {
        await cp(path.join(root, "node_modules", dependency), path.join(appRoot, "node_modules", dependency), { recursive: true, dereference: true })
    }

    const asarPath = path.join(tempRoot, "app.asar")
    await createPackage(appRoot, asarPath)
    return { tempRoot, asarPath }
}

async function main() {
    const looseExitCode = await runElectronApp(testApp)
    if (looseExitCode !== 0) throw new Error(`Loose Electron harness exited with code ${looseExitCode}`)

    const { tempRoot, asarPath } = await makeAsarTestApp()
    try {
        const asarExitCode = await runElectronApp(asarPath)
        if (asarExitCode !== 0) throw new Error(`ASAR Electron harness exited with code ${asarExitCode}`)
    } finally {
        await rm(tempRoot, { recursive: true, force: true })
    }
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
