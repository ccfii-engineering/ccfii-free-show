import test from "node:test"
import assert from "node:assert/strict"

import { shouldCheckForUpdates } from "../../src/electron/utils/updateSupport.ts"

test("disables update checks for internal macOS builds", () => {
    assert.equal(
        shouldCheckForUpdates({
            isProd: true,
            platform: "darwin",
            internalBuild: true
        }),
        false
    )
})

test("allows update checks for signed macOS releases", () => {
    assert.equal(
        shouldCheckForUpdates({
            isProd: true,
            platform: "darwin",
            internalBuild: false
        }),
        true
    )
})

test("allows update checks for internal Windows builds", () => {
    assert.equal(
        shouldCheckForUpdates({
            isProd: true,
            platform: "win32",
            internalBuild: true
        }),
        true
    )
})

test("disables update checks in development", () => {
    assert.equal(
        shouldCheckForUpdates({
            isProd: false,
            platform: "linux",
            internalBuild: false
        }),
        false
    )
})
