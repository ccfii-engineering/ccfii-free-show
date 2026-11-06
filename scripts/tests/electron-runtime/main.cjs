// Runs inside Electron: verifies the runtime major and that each native add-on loads (or reports itself unavailable).
const path = require("node:path")
const { app } = require("electron")

const projectRoot = path.resolve(__dirname, "../../..")
const expectedMajor = Number(process.argv[process.argv.indexOf("--expected-major") + 1])
const requireFromProject = require("node:module").createRequire(path.join(projectRoot, "package.json"))

// each check returns a short detail string; optional add-ons may fail to load on some platforms (the app degrades gracefully)
const checks = [
    {
        name: "better-sqlite3",
        required: true,
        run() {
            const Database = requireFromProject("better-sqlite3")
            const db = new Database(":memory:")
            db.exec("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (42)")
            const row = db.prepare("SELECT a FROM t").get()
            db.close()
            if (row.a !== 42) throw new Error("unexpected query result")
            return "query ok"
        }
    },
    {
        name: "@discordjs/opus",
        required: true,
        run() {
            const { OpusEncoder } = requireFromProject("@discordjs/opus")
            const encoder = new OpusEncoder(48000, 2)
            const encoded = encoder.encode(Buffer.alloc(960 * 2 * 2))
            if (!encoded.length) throw new Error("empty opus frame")
            return `encoded ${encoded.length} bytes`
        }
    },
    {
        // music-metadata 12 is ESM-only: the CommonJS main process loads it through require(esm) (module-sync export)
        name: "music-metadata (ESM via require)",
        required: true,
        run() {
            const { parseFile, parseBuffer } = requireFromProject("music-metadata")
            if (typeof parseFile !== "function" || typeof parseBuffer !== "function") throw new Error("missing exports")
            return "exports ok"
        }
    },
    {
        name: "@googleapis/drive",
        required: true,
        run() {
            const { drive, auth } = requireFromProject("@googleapis/drive")
            if (typeof drive !== "function" || typeof auth?.GoogleAuth !== "function") throw new Error("missing exports")
            const client = drive({ version: "v3" })
            if (typeof client.files?.list !== "function") throw new Error("files.list missing")
            return "client ok"
        }
    },
    {
        name: "libltc-wrapper",
        required: true,
        run() {
            const { LTCDecoder, LTCEncoder } = requireFromProject("libltc-wrapper")
            if (typeof LTCDecoder !== "function" || typeof LTCEncoder !== "function") throw new Error("missing exports")
            return "exports ok"
        }
    },
    {
        name: "grandiose (NDI)",
        required: false,
        run() {
            const grandiose = requireFromProject("grandiose")
            return `exports: ${Object.keys(grandiose).length}`
        }
    },
    {
        name: "macadam (Blackmagic)",
        required: false,
        run() {
            const macadam = requireFromProject("macadam")
            return `exports: ${Object.keys(macadam).length}`
        }
    }
]

app.whenReady().then(() => {
    const versions = { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8, modules: process.versions.modules }
    console.info("RUNTIME", JSON.stringify(versions))
    let failed = false

    if (Number(versions.electron.split(".")[0]) !== expectedMajor) {
        console.error(`FAIL electron major ${versions.electron} (expected ${expectedMajor})`)
        failed = true
    }

    for (const check of checks) {
        try {
            console.info(`PASS ${check.name}: ${check.run()}`)
        } catch (err) {
            const message = String(err?.message || err).split("\n")[0]
            if (check.required) {
                console.error(`FAIL ${check.name}: ${message}`)
                failed = true
            } else {
                console.warn(`UNAVAILABLE ${check.name} (optional, app degrades gracefully): ${message}`)
            }
        }
    }

    app.exit(failed ? 1 : 0)
})
