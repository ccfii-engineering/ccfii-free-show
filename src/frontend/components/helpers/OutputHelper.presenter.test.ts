import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ openProjectItem: vi.fn(), setOutput: vi.fn(), updateOut: vi.fn(), outputLines: 0, slideLines: 0 }))

vi.mock("../../audio/audioPlayer", () => ({ AudioPlayer: { getAllPlaying: vi.fn(() => []) } }))
vi.mock("../../IPC/main", () => ({ sendMain: vi.fn() }))
vi.mock("../../utils/shortcuts", () => ({ playFolder: vi.fn(), togglePlayingMedia: vi.fn() }))
vi.mock("../../utils/language", () => ({ translateText: (key: string) => key }))
vi.mock("../show/project", () => ({ openProjectItem: mocks.openProjectItem }))
vi.mock("./output", () => ({ getAllActiveOutputIds: vi.fn(() => []), setOutput: mocks.setOutput }))
vi.mock("./showActions", () => ({
    checkActionTrigger: vi.fn(),
    getFewestOutputLines: vi.fn(() => mocks.outputLines),
    getItemWithMostLines: vi.fn(() => mocks.slideLines),
    playPdf: vi.fn(),
    updateOut: mocks.updateOut
}))
vi.mock("../actions/actions", () => ({ runActionId: vi.fn() }))

import { OutputHelper } from "./OutputHelper"
import { activeFocus, activeProject, activeShow, focusMode, outLocked, outputs, outputSlideCache, projects, showsCache, special, styles } from "../../stores"

function show(id: string) {
    return {
        id,
        name: id,
        settings: { activeLayout: "default" },
        slides: {
            first: { group: "", color: null, settings: {}, notes: "", items: [] },
            second: { group: "", color: null, settings: {}, notes: "", items: [] }
        },
        layouts: { default: { slides: [{ id: "first" }, { id: "second" }] } }
    }
}

describe("presenter next follows OutputHelper navigation", () => {
    beforeEach(() => {
        mocks.openProjectItem.mockClear()
        mocks.setOutput.mockClear()
        mocks.updateOut.mockClear()
        mocks.outputLines = 0
        mocks.slideLines = 0
        ;(globalThis as any).document = { activeElement: null }
        outputs.set({
            output: {
                id: "output",
                name: "Main",
                enabled: true,
                active: true,
                color: "",
                bounds: { x: 0, y: 0, width: 1, height: 1 },
                screen: null,
                out: { slide: { id: "show-b", layout: "default", index: 0 } }
            }
        })
        projects.set({
            project: {
                name: "Project",
                created: 0,
                parent: "",
                shows: [
                    { id: "show-a", index: 0 },
                    { id: "show-b", index: 1 }
                ]
            }
        })
        activeProject.set("project")
        activeShow.set({ id: "show-a", index: 0 })
        activeFocus.set({ id: "show-a", index: 0 })
        focusMode.set(false)
        showsCache.set({ "show-a": show("show-a"), "show-b": show("show-b") } as any)
        outputSlideCache.set({})
        special.set({})
        styles.set({})
        outLocked.set(false)
    })

    it("previews the first slide of B when Next quick-switches from active A", () => {
        const predicted = OutputHelper.getPresenterNext("output")

        OutputHelper.advanceOutput("output", "ArrowRight")

        expect(mocks.openProjectItem).toHaveBeenCalledWith("project", 1)
        expect(predicted).toMatchObject({ id: "show-b", layout: "default", index: 0 })
        expect(mocks.setOutput).not.toHaveBeenCalled()
    })

    it("previews the next line window selected by the active output style", async () => {
        await new Promise((resolve) => setTimeout(resolve, 55))
        outputs.update((all) => ({ ...all, output: { ...all.output, style: "style" } }))
        activeShow.set({ id: "show-b", index: 1 })
        mocks.outputLines = 2
        mocks.slideLines = 4
        styles.set({ style: { name: "Line window", lines: 2 } })

        const predicted = OutputHelper.getPresenterNext("output")
        OutputHelper.advanceOutput("output", "ArrowRight")
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(predicted).toMatchObject({ id: "show-b", layout: "default", index: 0, line: 2 })
        expect(mocks.setOutput).toHaveBeenCalledWith("slide", { id: "show-b", layout: "default", index: 0, line: 2 }, false, "output")
    })
})
