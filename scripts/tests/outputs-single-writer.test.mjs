import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const frontend = path.join(root, "src/frontend")

function* sourceFiles(dir) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) yield* sourceFiles(full)
        else if (/\.(ts|svelte)$/.test(name)) yield full
    }
}

const files = [...sourceFiles(frontend)].map((file) => ({ file: path.relative(root, file), text: readFileSync(file, "utf8") }))

test("outputs are written only through the outputs domain module", () => {
    const direct = /(?<![\w.$])outputs\.(set|update)\(/
    const offenders = files.filter(({ file, text }) => !file.endsWith("outputs.svelte.ts") && text.split("\n").some((line) => direct.test(line) && !line.trim().startsWith("//")))
    assert.deepEqual(
        offenders.map(({ file }) => file),
        []
    )
})

test("the public outputs store is read-only", () => {
    const module = files.find(({ file }) => file === "src/frontend/outputState/outputs.svelte.ts")
    assert.ok(module)
    assert.match(module.text, /export const outputs: Readable<Outputs> = \{ subscribe: state\.subscribe \}/)
})

test("writableOutputs is only referenced by the module and the generic store map", () => {
    const users = files.filter(({ text }) => text.includes("writableOutputs")).map(({ file }) => file)
    assert.deepEqual(users.sort(), ["src/frontend/outputState/outputs.svelte.ts", "src/frontend/outputState/outputs.test.ts", "src/frontend/stores.ts"])
})

test("output helpers take real outputs data instead of dummy updater parameters", () => {
    const helper = files.find(({ file }) => file === "src/frontend/components/helpers/output.ts").text
    assert.doesNotMatch(helper, /_updater[^,)]*outputs/)
    assert.doesNotMatch(helper, /function (getFirstActiveOutput|getResolution|getStageResolution)\([^)]*_updater/)
    for (const signature of [/function getFirstActiveOutput\(outputsData/, /function getResolution\([^)]*data:/, /function getStageResolution\(outputId = "", outputsData/]) {
        assert.match(helper, signature)
    }
})
