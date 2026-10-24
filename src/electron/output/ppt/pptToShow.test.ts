import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { writePptxFixture } from "../../../../scripts/tests/helpers/pptxFixture"

const state = vi.hoisted(() => ({ dataRoot: "" }))

vi.mock("electron", () => ({
    ipcMain: { on: vi.fn() },
    app: {
        getPath: () => state.dataRoot,
        setPath: vi.fn()
    },
    dialog: {},
    shell: {}
}))
vi.mock("../../data/store", () => ({
    _store: {},
    appDataPath: state.dataRoot,
    config: { get: () => undefined },
    getStore: vi.fn(),
    setStore: vi.fn(),
    setStoreValue: vi.fn()
}))
vi.mock("../..", () => ({
    isMac: false,
    isProd: true,
    isWindows: false,
    isLinux: true,
    getMainWindow: vi.fn(),
    toApp: vi.fn()
}))
vi.mock("../../IPC/main", () => ({ sendToMain: vi.fn(), sendMain: vi.fn() }))

describe("pptToShow media extraction", () => {
    let tempRoot = ""
    let pptToShow: typeof import("./pptToShow").pptToShow

    beforeAll(async () => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "freeshow-pptx-import-"))
        state.dataRoot = path.join(tempRoot, "app-data")
        fs.mkdirSync(state.dataRoot, { recursive: true })
        ;({ pptToShow } = await import("./pptToShow"))
    })

    afterAll(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true })
    })

    it("keeps assets from an earlier import when another deck has the same filename", async () => {
        const sourceOne = path.join(tempRoot, "first", "same-name.pptx")
        const sourceTwo = path.join(tempRoot, "second", "same-name.pptx")
        fs.mkdirSync(path.dirname(sourceOne), { recursive: true })
        fs.mkdirSync(path.dirname(sourceTwo), { recursive: true })

        await writePptxFixture(sourceOne, { "ppt/media/image1.png": Buffer.from("first-image") })
        await writePptxFixture(sourceTwo, { "ppt/media/image1.png": Buffer.from("second-image") })

        const firstImport = await pptToShow(sourceOne)
        const firstAssetPath = firstImport?.contentPaths["ppt/media/image1.png"]
        expect(firstAssetPath).toBeTruthy()
        expect(fs.readFileSync(firstAssetPath!, "utf8")).toBe("first-image")

        await pptToShow(sourceTwo)

        expect(fs.readFileSync(firstAssetPath!, "utf8")).toBe("first-image")
    })

    it("keeps distinct package entries with the same basename at distinct paths", async () => {
        const source = path.join(tempRoot, "nested-assets.pptx")
        await writePptxFixture(source, {
            "ppt/media/variant-a/image.png": Buffer.from("variant-a"),
            "ppt/media/variant-b/image.png": Buffer.from("variant-b")
        })

        const imported = await pptToShow(source)
        const firstPath = imported?.contentPaths["ppt/media/variant-a/image.png"]
        const secondPath = imported?.contentPaths["ppt/media/variant-b/image.png"]

        expect(firstPath).toBeTruthy()
        expect(secondPath).toBeTruthy()
        expect(firstPath).not.toBe(secondPath)
        const contentRoot = path.resolve(path.dirname(firstPath!), "../../../")
        for (const assetPath of [firstPath!, secondPath!]) {
            const relativePath = path.relative(contentRoot, assetPath)
            expect(relativePath).not.toBe("..")
            expect(relativePath.startsWith(`..${path.sep}`)).toBe(false)
            expect(path.isAbsolute(relativePath)).toBe(false)
        }
        expect(fs.readFileSync(firstPath!, "utf8")).toBe("variant-a")
        expect(fs.readFileSync(secondPath!, "utf8")).toBe("variant-b")
    })
})
