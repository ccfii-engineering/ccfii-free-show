// Builds @discordjs/opus for the installed Electron version when the Electron-ABI binary is missing,
// then fails (non-zero exit) if it still is not there.
//   node scripts/build/ensureOpusBinary.js [--arch=x64,arm64] [--check]
// Default arch is the host arch. --check only verifies. Run after `npm install`, before packaging.
const { spawnSync } = require("child_process")
const { dirname, join } = require("path")
const { assertOpusBinary, findOpusBinary } = require("./opusBinary")

const root = join(__dirname, "..", "..")
const platform = process.platform
const archArg = process.argv.find((a) => a.startsWith("--arch="))
const archs = archArg ? archArg.slice("--arch=".length).split(",") : [process.arch]
const checkOnly = process.argv.includes("--check")

const electronVersion = require(join(root, "node_modules", "electron", "package.json")).version
const opusDir = dirname(require.resolve("@discordjs/opus/package.json", { paths: [root] }))
const nodePreGyp = require.resolve("@discordjs/node-pre-gyp/bin/node-pre-gyp", { paths: [opusDir] })

for (const arch of archs) {
    if (!checkOnly && !findOpusBinary(root, platform, arch)) {
        console.info(`Building @discordjs/opus for Electron ${electronVersion} (${platform}-${arch})`)
        const result = spawnSync(process.execPath, [nodePreGyp, "install", "--fallback-to-build", "--runtime=electron", `--target=${electronVersion}`, `--target_arch=${arch}`, "--dist-url=https://electronjs.org/headers"], { cwd: opusDir, stdio: "inherit" })
        if (result.status !== 0) {
            console.error(`@discordjs/opus build failed for ${platform}-${arch}`)
            process.exit(result.status || 1)
        }
    }
    console.info(`@discordjs/opus OK: ${assertOpusBinary(root, platform, arch)}`)
}
