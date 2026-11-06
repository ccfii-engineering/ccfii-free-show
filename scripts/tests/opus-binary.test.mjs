import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const { findOpusBinary, assertOpusBinary, findUnpackedRoots } = require("../build/opusBinary.js")

function fakePackage(dirName) {
    const root = mkdtempSync(join(tmpdir(), "opus-test-"))
    const dir = join(root, "node_modules", "@discordjs", "opus", "prebuild", dirName)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opus.node"), "")
    return root
}

test("finds the Electron-ABI opus binary for the requested platform and arch", () => {
    const root = fakePackage("electron-v45.2-napi-v3-win32-x64-unknown-unknown")
    try {
        assert.ok(findOpusBinary(root, "win32", "x64")?.endsWith("opus.node"))
        assert.equal(findOpusBinary(root, "win32", "arm64"), null)
        assert.equal(findOpusBinary(root, "darwin", "x64"), null)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("ignores plain Node ABI binaries, which Electron cannot resolve", () => {
    const root = fakePackage("node-v147-napi-v3-linux-x64-glibc-2.44")
    try {
        assert.equal(findOpusBinary(root, "linux", "x64"), null)
        assert.throws(() => assertOpusBinary(root, "linux", "x64"), /@discordjs\/opus.*Electron/s)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("locates app.asar.unpacked inside a packaged output directory", () => {
    const root = mkdtempSync(join(tmpdir(), "opus-test-"))
    try {
        mkdirSync(join(root, "FreeShow.app", "Contents", "Resources", "app.asar.unpacked"), { recursive: true })
        assert.deepEqual(findUnpackedRoots(root), [join(root, "FreeShow.app", "Contents", "Resources", "app.asar.unpacked")])
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("both builder configs verify the opus binary after packing", () => {
    assert.match(readFileSync("config/building/electron-builder.yaml", "utf8"), /^afterPack:\s*scripts\/build\/afterPackOpus\.js\s*$/m)
    assert.match(readFileSync("config/building/electron-builder.internal.js", "utf8"), /afterPack:\s*["']scripts\/build\/afterPackOpus\.js["']/)
})

test("release workflow builds and checks opus for both desktop jobs", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8")
    assert.equal(workflow.match(/node scripts\/build\/ensureOpusBinary\.js/g)?.length, 2)
})
