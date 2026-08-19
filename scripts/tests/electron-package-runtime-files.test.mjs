import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("packages shared runtime modules used by the Electron main process", () => {
    const releaseConfig = readFileSync("config/building/electron-builder.yaml", "utf8")
    assert.match(releaseConfig, /^\s*- build\/common\/\*\*\s*$/m)

    const internalConfig = readFileSync("config/building/electron-builder.internal.js", "utf8")
    assert.match(internalConfig, /["']build\/common\/\*\*["']/)
})
