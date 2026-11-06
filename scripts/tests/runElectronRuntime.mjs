// Launches scripts/tests/electron-runtime in the installed Electron binary and fails on a wrong major or a required native add-on that does not load.
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import electronPath from "electron"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const testApp = path.join(root, "scripts/tests/electron-runtime")
const declared = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).devDependencies.electron
const expectedMajor = declared.match(/\d+/)[0]
const useXvfb = process.platform === "linux" && !process.env.DISPLAY && existsSync("/usr/bin/xvfb-run")

const args = [testApp, "--no-sandbox", "--expected-major", expectedMajor]
const command = useXvfb ? "/usr/bin/xvfb-run" : electronPath
const commandArgs = useXvfb ? ["-a", electronPath, ...args] : args
const child = spawn(command, commandArgs, { cwd: root, stdio: "inherit", env: process.env })
child.once("error", (err) => {
    console.error(err)
    process.exit(1)
})
child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
