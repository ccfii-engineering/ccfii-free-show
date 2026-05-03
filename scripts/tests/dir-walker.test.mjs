import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { walkFolder } from "../../src/electron/indexer/DirWalker.ts"

async function makeFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dirwalker-"))
    await fs.mkdir(path.join(root, "sub"))
    await fs.mkdir(path.join(root, "sub", "deep"))
    for (let i = 0; i < 10; i++) await fs.writeFile(path.join(root, `f${i}.txt`), "x")
    for (let i = 0; i < 5; i++) await fs.writeFile(path.join(root, "sub", `g${i}.txt`), "x")
    await fs.writeFile(path.join(root, "sub", "deep", "h.txt"), "x")
    return root
}

test("walkFolder emits batches and total entries match", async () => {
    const root = await makeFixture()
    const batches = []
    let totalFiles = 0
    let totalFolders = 0
    await walkFolder({ paths: [root], depth: 5, captureFolderContent: false, batchSize: 8 }, (batch) => {
        batches.push(batch.length)
        for (const entry of batch) {
            if (entry.isFolder) totalFolders++
            else totalFiles++
        }
    })
    assert.ok(batches.length >= 2, `expected >= 2 batches, got ${batches.length}`)
    assert.equal(totalFiles, 16, "10 + 5 + 1 = 16 files")
    // 3 folders: root, sub, sub/deep
    assert.equal(totalFolders, 3)
})

test("walkFolder emits folder entries with files array", async () => {
    const root = await makeFixture()
    const folders = []
    await walkFolder({ paths: [root], depth: 5, captureFolderContent: false, batchSize: 50 }, (batch) => {
        for (const entry of batch) {
            if (entry.isFolder) folders.push(entry)
        }
    })
    const rootFolder = folders.find((f) => f.path === root)
    assert.ok(rootFolder, "root folder entry exists")
    assert.ok(Array.isArray(rootFolder.files), "root folder has files array")
    assert.equal(rootFolder.files.length, 11, "10 .txt files + 1 sub folder")
})

test("walkFolder skips unreadable subfolders without aborting", async () => {
    const root = await makeFixture()
    const entries = []
    await walkFolder({ paths: [root, path.join(root, "does-not-exist")], depth: 1, captureFolderContent: false, batchSize: 50 }, (batch) => {
        entries.push(...batch)
    })
    assert.ok(entries.length > 0, "real root still produced entries")
})

test("walkFolder emits at least one batch even for empty folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dirwalker-empty-"))
    const batches = []
    await walkFolder({ paths: [root], depth: 5, captureFolderContent: false, batchSize: 50 }, (batch) => {
        batches.push(batch)
    })
    // Empty folder should still emit the folder entry itself
    assert.equal(batches.length, 1)
    assert.equal(batches[0][0].path, root)
    assert.equal(batches[0][0].isFolder, true)
})

test("walkFolder respects depth limit", async () => {
    const root = await makeFixture()
    const folders = []
    await walkFolder({ paths: [root], depth: 0, captureFolderContent: false, batchSize: 50 }, (batch) => {
        for (const entry of batch) {
            if (entry.isFolder) folders.push(entry)
        }
    })
    // depth 0 means we only walk the root; subfolders should appear as folder entries
    // but not be recursed into, so "sub" should appear but "sub/deep" should not
    const deep = folders.find((f) => f.path.endsWith("deep"))
    assert.equal(deep, undefined, "should not recurse past depth limit")
})
