// electron-builder afterPack hook: fail the build if the packaged app lacks the Electron-ABI opus binary.
const { assertOpusBinary, findUnpackedRoots } = require("./opusBinary")

// electron-builder Arch enum: 0 ia32, 1 x64, 2 armv7l, 3 arm64, 4 universal
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "arm", 3: "arm64" }

module.exports = async function afterPackOpus(context) {
    const platform = context.electronPlatformName
    const arch = ARCH_NAMES[context.arch]
    if (!arch) return // universal builds merge per-arch packs, each already checked

    const roots = findUnpackedRoots(context.appOutDir)
    if (!roots.length) throw new Error(`No app.asar.unpacked in ${context.appOutDir}: native add-ons (@discordjs/opus) are not unpacked from the asar`)
    for (const root of roots) assertOpusBinary(root, platform, arch)
}
