// @discordjs/opus is an N-API add-on, so electron-builder's install-app-deps (@electron/rebuild)
// reports success without producing the Electron-ABI binary that node-pre-gyp looks up at runtime
// (prebuild/electron-v<major>.<minor>-napi-v3-<platform>-<arch>-<libc>-<libc_version>/opus.node).
// These helpers find and assert that binary, in node_modules and in a packaged app.
const { existsSync, readdirSync } = require("fs")
const { join } = require("path")

const OPUS_PREBUILD = join("node_modules", "@discordjs", "opus", "prebuild")

/** Absolute path to the Electron-ABI opus.node under `root`, or null. */
function findOpusBinary(root, platform, arch) {
    const prebuildDir = join(root, OPUS_PREBUILD)
    if (!existsSync(prebuildDir)) return null

    const prefix = new RegExp(`^electron-v\\d+\\.\\d+-napi-v\\d+-${platform}-${arch}-`)
    for (const name of readdirSync(prebuildDir)) {
        if (!prefix.test(name)) continue
        const binary = join(prebuildDir, name, "opus.node")
        if (existsSync(binary)) return binary
    }
    return null
}

function assertOpusBinary(root, platform, arch) {
    const binary = findOpusBinary(root, platform, arch)
    if (!binary) {
        throw new Error(`@discordjs/opus has no Electron-ABI binary for ${platform}-${arch} under ${join(root, OPUS_PREBUILD)}. Run: node scripts/build/ensureOpusBinary.js`)
    }
    return binary
}

/** Directories named app.asar.unpacked inside a packaged output directory (shallow search). */
function findUnpackedRoots(dir, depth = 5) {
    if (depth < 0 || !existsSync(dir)) return []
    const found = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const path = join(dir, entry.name)
        if (entry.name === "app.asar.unpacked") found.push(path)
        else if (entry.name !== "node_modules") found.push(...findUnpackedRoots(path, depth - 1))
    }
    return found
}

module.exports = { findOpusBinary, assertOpusBinary, findUnpackedRoots }
