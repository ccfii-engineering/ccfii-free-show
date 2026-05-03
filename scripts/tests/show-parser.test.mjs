import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { parseShowsFolder } from "../../src/electron/indexer/ShowParser.ts"

async function makeShowsFixture(count) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "showparser-"))
    for (let i = 0; i < count; i++) {
        const id = `id-${i}`
        const show = [id, { name: `Song ${i}`, category: "songs", timestamps: { created: i, modified: null, used: null }, slides: {}, layouts: {} }]
        await fs.writeFile(path.join(root, `Song ${i}.show`), JSON.stringify(show))
    }
    await fs.writeFile(path.join(root, "ignore.txt"), "x")
    return root
}

test("parseShowsFolder emits multiple chunks for many shows", async () => {
    const root = await makeShowsFixture(250)
    const chunks = []
    await parseShowsFolder(root, { chunkSize: 100 }, (chunk) => chunks.push(chunk))
    const total = chunks.reduce((n, c) => n + Object.keys(c).length, 0)
    assert.equal(total, 250)
    assert.ok(chunks.length >= 3, `expected >= 3 chunks for 250 shows at chunkSize 100, got ${chunks.length}`)
})

test("parseShowsFolder skips non-.show files", async () => {
    const root = await makeShowsFixture(5)
    const chunks = []
    await parseShowsFolder(root, { chunkSize: 100 }, (chunk) => chunks.push(chunk))
    const merged = Object.assign({}, ...chunks)
    assert.equal(Object.keys(merged).length, 5)
})

test("parseShowsFolder handles malformed JSON without aborting", async () => {
    const root = await makeShowsFixture(3)
    // Drop a corrupt show file in the same folder
    await fs.writeFile(path.join(root, "broken.show"), "{not-valid-json")
    const chunks = []
    await parseShowsFolder(root, { chunkSize: 100 }, (chunk) => chunks.push(chunk))
    const merged = Object.assign({}, ...chunks)
    assert.equal(Object.keys(merged).length, 3, "valid shows still parsed; bad one skipped")
})

test("parseShowsFolder produces TrimmedShow shape", async () => {
    const root = await makeShowsFixture(1)
    const chunks = []
    await parseShowsFolder(root, { chunkSize: 100 }, (chunk) => chunks.push(chunk))
    const merged = Object.assign({}, ...chunks)
    const entry = Object.values(merged)[0]
    assert.equal(entry.name, "Song 0")
    assert.equal(entry.category, "songs")
    assert.ok(entry.timestamps)
    assert.equal(entry.timestamps.created, 0)
})

test("parseShowsFolder no-op for empty folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "showparser-empty-"))
    const chunks = []
    await parseShowsFolder(root, { chunkSize: 100 }, (chunk) => chunks.push(chunk))
    assert.equal(chunks.length, 0)
})
