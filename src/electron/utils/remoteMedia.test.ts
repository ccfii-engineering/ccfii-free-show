import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Dir, Dirent } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RemoteMediaBrowser, RemoteMediaError, remoteMediaLimits } from "./remoteMedia"

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((done, fail) => {
        resolve = done
        reject = fail
    })
    return { promise, resolve, reject }
}

function fakeDirectory(entryName: string, onClose: () => void): Dir {
    const entry = {
        name: entryName,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false
    } as Dirent
    let closed = false
    return {
        read: async () => entry,
        close: async () => {
            if (closed) return
            closed = true
            onClose()
        }
    } as unknown as Dir
}

function fileEntry(name: string): Dirent {
    return { name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false } as Dirent
}

async function waitFor(predicate: () => boolean) {
    const started = Date.now()
    while (!predicate()) {
        if (Date.now() - started > 2000) throw new Error("Timed out waiting for media operation")
        await new Promise((resolve) => setTimeout(resolve, 1))
    }
}

function createFixture() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "freeshow-remote-media-"))
    const root = path.join(tempRoot, "media")
    fs.mkdirSync(root)
    const directories = Array.from({ length: 5 }, (_, index) => {
        const directory = path.join(root, `folder-${index}`)
        fs.mkdirSync(directory)
        fs.writeFileSync(path.join(directory, "asset.png"), "image")
        return directory
    })

    return { tempRoot, root, directories }
}

function createRootVersionFixture() {
    const fixture = createFixture()
    const approvedRootB = path.join(fixture.tempRoot, "approved-b")
    fs.mkdirSync(approvedRootB)
    fs.writeFileSync(path.join(approvedRootB, "target.png"), "image")
    for (let index = 0; index < remoteMediaLimits.pageSize; index++) {
        fs.writeFileSync(path.join(fixture.directories[0], `item-${index}.png`), "image")
    }
    fs.symlinkSync(approvedRootB, path.join(fixture.directories[0], "link-to-b"), "dir")

    let configuredRoots = [
        { id: "root-a", name: "Root A", path: fixture.directories[0] },
        { id: "root-b", name: "Root B", path: approvedRootB }
    ]
    let rootReads = 0
    let mutateOnRead = Number.POSITIVE_INFINITY
    const entries = [...Array.from({ length: remoteMediaLimits.pageSize }, (_, index) => fileEntry(`item-${index}.png`)), fileEntry("link-to-b")]
    let entryIndex = 0
    const browser = new RemoteMediaBrowser({
        getRoots: () => {
            rootReads++
            const snapshot = configuredRoots.map((root) => ({ ...root }))
            if (rootReads === mutateOnRead) queueMicrotask(() => (configuredRoots = [configuredRoots[0]]))
            return snapshot
        },
        isConnectionActive: () => true,
        makeThumbnail: async () => "",
        openDirectory: async () => {
            return {
                read: async () => entries[entryIndex++] || null,
                close: async () => undefined
            } as unknown as Dir
        }
    })

    return {
        fixture,
        approvedRootB,
        browser,
        configuredRoots: () => configuredRoots,
        mutateAfterRootReads: (count: number) => (mutateOnRead = rootReads + count),
        rootReadCount: () => rootReads
    }
}

describe("RemoteMediaBrowser bounded cursors", () => {
    let tempRoot = ""

    afterEach(() => {
        if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
        tempRoot = ""
        vi.restoreAllMocks()
    })

    it("reserves directory slots before parallel opens and rejects same-owner duplicate starts", async () => {
        const fixture = createFixture()
        tempRoot = fixture.tempRoot
        let openHandles = 0
        let peakHandles = 0
        const gates = new Map<string, ReturnType<typeof deferred<void>>>()
        const started: string[] = []
        const browser = new RemoteMediaBrowser({
            getRoots: () => [{ id: "root", name: "Media", path: fixture.root }],
            isConnectionActive: () => true,
            makeThumbnail: async () => "",
            openDirectory: async (directoryPath) => {
                started.push(directoryPath)
                const gate = gates.get(directoryPath)
                if (gate) await gate.promise
                openHandles++
                peakHandles = Math.max(peakHandles, openHandles)
                return fakeDirectory("asset.png", () => openHandles--)
            }
        })

        let oldestCursor = ""
        for (let index = 0; index < 3; index++) {
            const page = await browser.page({ connectionId: `owner-${index}`, requestId: `first-${index}`, path: fixture.directories[index], page: 0 })
            expect(page.items).toHaveLength(remoteMediaLimits.pageSize)
            if (index === 0) oldestCursor = page.nextCursor || ""
        }
        expect(openHandles).toBe(3)

        const fourthGate = deferred<void>()
        const fifthGate = deferred<void>()
        gates.set(fixture.directories[3], fourthGate)
        gates.set(fixture.directories[4], fifthGate)
        const fourth = browser.page({ connectionId: "owner-3", requestId: "fourth", path: fixture.directories[3], page: 0 })
        await waitFor(() => started.includes(fixture.directories[3]))
        const duplicate = browser.page({ connectionId: "owner-3", requestId: "duplicate", path: fixture.directories[3], page: 0 })
        await expect(duplicate).rejects.toMatchObject({ code: "busy" })
        const fifth = browser.page({ connectionId: "owner-4", requestId: "fifth", path: fixture.directories[4], page: 0 })
        await waitFor(() => started.includes(fixture.directories[4]))

        fourthGate.resolve()
        fifthGate.resolve()
        const [fourthPage, fifthPage] = await Promise.all([fourth, fifth])
        expect(fourthPage.items).toHaveLength(remoteMediaLimits.pageSize)
        expect(fifthPage.items).toHaveLength(remoteMediaLimits.pageSize)
        expect(peakHandles).toBeLessThanOrEqual(remoteMediaLimits.maxDirectoryHandles)
        expect(started.filter((directoryPath) => directoryPath === fixture.directories[3])).toHaveLength(1)
        await expect(browser.page({ connectionId: "owner-0", requestId: "first-0", path: fixture.directories[0], page: 1, cursor: oldestCursor })).rejects.toMatchObject({ code: "cursor_expired" })

        await browser.closeAll()
        expect(openHandles).toBe(0)
    })

    it("closes a directory returned after cancellation and connection revocation", async () => {
        const fixture = createFixture()
        tempRoot = fixture.tempRoot
        const gate = deferred<void>()
        let active = true
        let openHandles = 0
        let openStarted = false
        const browser = new RemoteMediaBrowser({
            getRoots: () => [{ id: "root", name: "Media", path: fixture.root }],
            isConnectionActive: () => active,
            makeThumbnail: async () => "",
            openDirectory: async () => {
                openStarted = true
                await gate.promise
                openHandles++
                return fakeDirectory("asset.png", () => openHandles--)
            }
        })
        const abort = new AbortController()
        const request = browser.page({ connectionId: "revoked", requestId: "scan", path: fixture.directories[0], page: 0 }, abort.signal)
        await waitFor(() => openStarted)
        active = false
        abort.abort()
        gate.resolve()

        await expect(request).rejects.toMatchObject({ name: "AbortError" })
        expect(openHandles).toBe(0)
        await browser.closeAll()
    })

    it("does not let an aborted old page continuation retire its replacement cursor", async () => {
        const fixture = createFixture()
        tempRoot = fixture.tempRoot
        const oldEntry = fileEntry("asset.png")
        const pendingRead = deferred<Dirent | null>()
        const readStarted = deferred<void>()
        let oldReads = 0
        let oldCloses = 0
        let newCloses = 0
        const browser = new RemoteMediaBrowser({
            getRoots: () => [{ id: "root", name: "Media", path: fixture.root }],
            isConnectionActive: () => true,
            makeThumbnail: async () => "",
            openDirectory: async (directoryPath) => {
                if (directoryPath === fixture.directories[0]) {
                    return {
                        read: async () => {
                            oldReads++
                            if (oldReads <= remoteMediaLimits.pageSize) return oldEntry
                            if (oldReads === remoteMediaLimits.pageSize + 1) {
                                readStarted.resolve(undefined)
                                return pendingRead.promise
                            }
                            return null
                        },
                        close: async () => oldCloses++
                    } as unknown as Dir
                }
                return fakeDirectory("asset.png", () => newCloses++)
            }
        })

        const oldFirst = await browser.page({ connectionId: "same-socket", requestId: "old", path: fixture.directories[0], page: 0 })
        const oldAbort = new AbortController()
        const oldContinuation = browser.page({ connectionId: "same-socket", requestId: "old", path: fixture.directories[0], page: 1, cursor: oldFirst.nextCursor || "" }, oldAbort.signal)
        await readStarted.promise

        const replacement = await browser.page({ connectionId: "same-socket", requestId: "new", path: fixture.directories[1], page: 0 })
        oldAbort.abort()
        pendingRead.reject(Object.assign(new Error("read cancelled"), { name: "AbortError" }))
        await expect(oldContinuation).rejects.toMatchObject({ name: "AbortError" })

        const replacementNext = await browser.page({
            connectionId: "same-socket",
            requestId: "new",
            path: fixture.directories[1],
            page: 1,
            cursor: replacement.nextCursor || ""
        })
        expect(replacementNext.requestId).toBe("new")
        expect(replacementNext.items).toHaveLength(remoteMediaLimits.pageSize)
        expect(oldCloses).toBe(1)

        await browser.closeAll()
        expect(newCloses).toBe(1)
    })

    it("invalidates cached media when a configured root is removed", async () => {
        const fixture = createFixture()
        tempRoot = fixture.tempRoot
        const approvedRootB = path.join(fixture.tempRoot, "approved-b")
        fs.mkdirSync(approvedRootB)
        fs.writeFileSync(path.join(approvedRootB, "target.png"), "image")
        for (let index = 0; index < remoteMediaLimits.pageSize; index++) {
            fs.writeFileSync(path.join(fixture.directories[0], `item-${index}.png`), "image")
        }
        fs.symlinkSync(approvedRootB, path.join(fixture.directories[0], "link-to-b"), "dir")
        let configuredRoots = [
            { id: "root-a", name: "Root A", path: fixture.directories[0] },
            { id: "root-b", name: "Root B", path: approvedRootB }
        ]
        const entries = [...Array.from({ length: remoteMediaLimits.pageSize }, (_, index) => fileEntry(`item-${index}.png`)), fileEntry("link-to-b")]
        let closes = 0
        const browser = new RemoteMediaBrowser({
            getRoots: () => configuredRoots,
            isConnectionActive: () => true,
            makeThumbnail: async () => "",
            openDirectory: async () => {
                let index = 0
                return {
                    read: async () => entries[index++] || null,
                    close: async () => closes++
                } as unknown as Dir
            }
        })

        const first = await browser.page({ connectionId: "root-owner", requestId: "root-change", path: fixture.directories[0], page: 0 })
        const second = await browser.page({
            connectionId: "root-owner",
            requestId: "root-change",
            path: fixture.directories[0],
            page: 1,
            cursor: first.nextCursor || ""
        })
        expect(second.items).toMatchObject([{ path: approvedRootB, name: "link-to-b", kind: "folder" }])

        configuredRoots = [configuredRoots[0]]
        await expect(browser.page({ connectionId: "root-owner", requestId: "root-change", path: fixture.directories[0], page: 1, cursor: first.nextCursor || "" })).rejects.toMatchObject({ code: "cursor_expired" })
        expect(closes).toBe(1)
        await browser.closeAll()
    })

    it("does not publish a page when approved roots change during its asynchronous scan", async () => {
        const fixture = createFixture()
        tempRoot = fixture.tempRoot
        const approvedRootB = path.join(fixture.tempRoot, "approved-b")
        fs.mkdirSync(approvedRootB)
        fs.writeFileSync(path.join(approvedRootB, "target.png"), "image")
        for (let index = 0; index < remoteMediaLimits.pageSize; index++) {
            fs.writeFileSync(path.join(fixture.directories[0], `item-${index}.png`), "image")
        }
        fs.symlinkSync(approvedRootB, path.join(fixture.directories[0], "link-to-b"), "dir")
        let configuredRoots = [
            { id: "root-a", name: "Root A", path: fixture.directories[0] },
            { id: "root-b", name: "Root B", path: approvedRootB }
        ]
        const linkEntry = fileEntry("link-to-b")
        const readStarted = deferred<void>()
        const linkGate = deferred<Dirent | null>()
        let opened = 0
        const browser = new RemoteMediaBrowser({
            getRoots: () => configuredRoots,
            isConnectionActive: () => true,
            makeThumbnail: async () => "",
            openDirectory: async () => {
                const deferLink = opened++ === 0
                const entries = Array.from({ length: remoteMediaLimits.pageSize }, (_, index) => fileEntry(`item-${index}.png`))
                let index = 0
                return {
                    read: async () => {
                        if (index < entries.length) return entries[index++]
                        if (deferLink && index === entries.length) {
                            index++
                            readStarted.resolve(undefined)
                            return linkGate.promise
                        }
                        if (index === entries.length + 1) {
                            index++
                            return linkEntry
                        }
                        return null
                    },
                    close: async () => undefined
                } as unknown as Dir
            }
        })

        const first = await browser.page({ connectionId: "changing-roots", requestId: "scan", path: fixture.directories[0], page: 0 })
        const pendingPage = browser.page({
            connectionId: "changing-roots",
            requestId: "scan",
            path: fixture.directories[0],
            page: 1,
            cursor: first.nextCursor || ""
        })
        await readStarted.promise
        configuredRoots = [configuredRoots[0]]
        linkGate.resolve(linkEntry)
        await expect(pendingPage).rejects.toMatchObject({ code: "cursor_expired" })

        const restarted = await browser.page({ connectionId: "changing-roots", requestId: "restart", path: fixture.directories[0], page: 0 })
        const restartedNext = await browser.page({
            connectionId: "changing-roots",
            requestId: "restart",
            path: fixture.directories[0],
            page: 1,
            cursor: restarted.nextCursor || ""
        })
        expect(restartedNext.items.some(({ path: mediaPath }) => mediaPath === approvedRootB)).toBe(false)
        await browser.closeAll()
    })

    it("rejects root browsing if its raw settings change during root canonicalization", async () => {
        const fixture = createRootVersionFixture()
        tempRoot = fixture.fixture.tempRoot
        fixture.mutateAfterRootReads(1)

        await expect(fixture.browser.page({ connectionId: "root-list", requestId: "root-list", path: "", page: 0 })).rejects.toMatchObject({ code: "cursor_expired" })
        expect(fixture.configuredRoots()).toHaveLength(1)
        await fixture.browser.closeAll()
    })

    it("rejects a fresh page when a queued root change lands during final canonicalization", async () => {
        const fixture = createRootVersionFixture()
        tempRoot = fixture.fixture.tempRoot
        const first = await fixture.browser.page({ connectionId: "fresh-root-change", requestId: "scan", path: fixture.fixture.directories[0], page: 0 })
        fixture.mutateAfterRootReads(4)

        await expect(
            fixture.browser.page({
                connectionId: "fresh-root-change",
                requestId: "scan",
                path: fixture.fixture.directories[0],
                page: 1,
                cursor: first.nextCursor || ""
            })
        ).rejects.toMatchObject({ code: "cursor_expired" })
        expect(fixture.configuredRoots()).toHaveLength(1)
        await fixture.browser.closeAll()
    })

    it("rejects cached pages when a queued root change lands during final canonicalization", async () => {
        const fixture = createRootVersionFixture()
        tempRoot = fixture.fixture.tempRoot
        const first = await fixture.browser.page({ connectionId: "cached-root-change", requestId: "scan", path: fixture.fixture.directories[0], page: 0 })
        const second = await fixture.browser.page({
            connectionId: "cached-root-change",
            requestId: "scan",
            path: fixture.fixture.directories[0],
            page: 1,
            cursor: first.nextCursor || ""
        })
        expect(second.items).toMatchObject([{ path: fixture.approvedRootB, kind: "folder" }])
        fixture.mutateAfterRootReads(4)

        await expect(
            fixture.browser.page({
                connectionId: "cached-root-change",
                requestId: "scan",
                path: fixture.fixture.directories[0],
                page: 1,
                cursor: first.nextCursor || ""
            })
        ).rejects.toMatchObject({ code: "cursor_expired" })
        expect(fixture.configuredRoots()).toHaveLength(1)
        await fixture.browser.closeAll()
    })

    it("bounds pages and rejects paths and symlinks outside approved roots", async () => {
        const fixture = createFixture()
        tempRoot = fixture.tempRoot
        const outside = path.join(tempRoot, "outside")
        fs.mkdirSync(outside)
        fs.writeFileSync(path.join(outside, "secret.png"), "secret")
        fs.symlinkSync(outside, path.join(fixture.root, "outside-link"), "dir")
        const browser = new RemoteMediaBrowser({
            getRoots: () => [{ id: "root", name: "Media", path: fixture.root }],
            isConnectionActive: () => true,
            makeThumbnail: async () => "",
            openDirectory: async () => fakeDirectory("asset.png", () => undefined)
        })

        const page = await browser.page({ connectionId: "safe", requestId: "bounded", path: fixture.directories[0], page: 0 })
        expect(page.items).toHaveLength(remoteMediaLimits.pageSize)
        expect(page.hasMore).toBe(true)
        expect(page.nextCursor).toBeTruthy()
        await expect(browser.page({ connectionId: "outside", requestId: "bad", path: outside, page: 0 })).rejects.toBeInstanceOf(RemoteMediaError)
        await expect(browser.page({ connectionId: "link", requestId: "bad-link", path: path.join(fixture.root, "outside-link"), page: 0 })).rejects.toMatchObject({ code: "invalid_path" })
        await browser.closeAll()
    })

    it("continues sparse folders after each bounded Dirent batch", async () => {
        const fixture = createFixture()
        tempRoot = fixture.tempRoot
        let reads = 0
        let closes = 0
        const hiddenEntry = { name: ".hidden", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false } as Dirent
        const mediaEntry = { name: "asset.png", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false } as Dirent
        const browser = new RemoteMediaBrowser({
            getRoots: () => [{ id: "root", name: "Media", path: fixture.root }],
            isConnectionActive: () => true,
            makeThumbnail: async () => "",
            openDirectory: async () => {
                return {
                    read: async () => {
                        reads++
                        if (reads <= remoteMediaLimits.pageScanLimit) return hiddenEntry
                        if (reads === remoteMediaLimits.pageScanLimit + 1) return mediaEntry
                        return null
                    },
                    close: async () => {
                        closes++
                    }
                } as unknown as Dir
            }
        })

        const first = await browser.page({ connectionId: "sparse", requestId: "scan", path: fixture.directories[0], page: 0 })
        expect(first.items).toHaveLength(0)
        expect(first.hasMore).toBe(true)
        expect(reads).toBe(remoteMediaLimits.pageScanLimit)

        const second = await browser.page({ connectionId: "sparse", requestId: "scan", path: fixture.directories[0], page: 1, cursor: first.nextCursor || "" })
        expect(second.items.map(({ name }) => name)).toEqual(["asset.png"])
        expect(second.hasMore).toBe(false)
        await browser.closeAll()
        expect(closes).toBe(1)
    })

    it("counts root browsing cursors toward the four-owner limit", async () => {
        const fixture = createFixture()
        tempRoot = fixture.tempRoot
        const rootPaths = Array.from({ length: remoteMediaLimits.pageSize + 1 }, (_, index) => {
            const rootPath = path.join(fixture.tempRoot, `configured-${index}`)
            fs.mkdirSync(rootPath)
            return { id: `root-${index}`, name: `Root ${index}`, path: rootPath }
        })
        const browser = new RemoteMediaBrowser({
            getRoots: () => rootPaths,
            isConnectionActive: () => true,
            makeThumbnail: async () => ""
        })

        const oldest = await browser.page({ connectionId: "root-owner-0", requestId: "root-0", path: "", page: 0 })
        expect(oldest.items).toHaveLength(remoteMediaLimits.pageSize)
        expect(oldest.hasMore).toBe(true)
        for (let index = 1; index <= remoteMediaLimits.maxSessions; index++) {
            await browser.page({ connectionId: `root-owner-${index}`, requestId: `root-${index}`, path: "", page: 0 })
        }

        await expect(browser.page({ connectionId: "root-owner-0", requestId: "root-0", path: "", page: 1, cursor: oldest.nextCursor || "" })).rejects.toMatchObject({ code: "cursor_expired" })
        await browser.closeAll()
    })
})
