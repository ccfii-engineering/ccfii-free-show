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

const stores = [
    { name: "media", module: "src/frontend/mediaState/media.svelte.ts", writable: "writableMedia", type: "Media" },
    { name: "showsCache", module: "src/frontend/showsCacheState/showsCache.svelte.ts", writable: "writableShowsCache", type: "Shows" }
]

for (const store of stores) {
    test(`${store.name} is written only through its domain module`, () => {
        const direct = new RegExp(`(?<![\\w.$])${store.name}\\.(set|update)\\(`)
        const store$ = new RegExp(`\\$${store.name}(\\[[^\\]]*\\]|\\.\\w+)*\\s*(=[^=]|\\+\\+|--|\\+=|-=)`)
        const offenders = files.filter(({ file, text }) => file !== store.module && text.split("\n").some((line) => (direct.test(line) || store$.test(line)) && !line.trim().startsWith("//")))
        assert.deepEqual(
            offenders.map(({ file }) => file),
            []
        )
    })

    test(`the public ${store.name} store is read-only`, () => {
        const module = files.find(({ file }) => file === store.module)
        assert.ok(module)
        assert.match(module.text, new RegExp(`export const ${store.name}: Readable<${store.type}> = \\{ subscribe: state\\.subscribe \\}`))
        const storesFile = files.find(({ file }) => file === "src/frontend/stores.ts").text
        assert.doesNotMatch(storesFile, new RegExp(`export const ${store.name}: Writable`))
    })

    test(`${store.writable} is only referenced by its module, its test and the generic store map`, () => {
        const users = files.filter(({ text }) => text.includes(store.writable)).map(({ file }) => file)
        assert.deepEqual(users.sort(), [store.module, store.module.replace(".svelte.ts", ".test.ts"), "src/frontend/stores.ts"].sort())
    })
}

test("history updaters get a writable store face (the public stores are read-only)", () => {
    const text = files.find(({ file }) => file === "src/frontend/components/helpers/historyHelpers.ts").text
    assert.doesNotMatch(text, /store: (showsCache|media|outputs)\b/)
    assert.match(text, /store: \$\.showsCache/)
    assert.match(text, /store: \$\.outputs/)
})

test("per-entry accessors for media and shows come from the rune stores, not the JSON gate", () => {
    const text = files.find(({ file }) => file === "src/frontend/utils/perEntryStores.ts").text
    assert.doesNotMatch(text, /createEntryAccessor\((media|showsCache)\)/)
})
