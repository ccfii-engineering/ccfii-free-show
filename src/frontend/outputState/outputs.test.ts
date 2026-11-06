import { flushSync } from "svelte"
import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Output } from "../../types/Output"
import { getOutput, outputs, patchOutput, removeOutput, selectOutput, setOutputs, updateOutputs, writableOutputs } from "./outputs.svelte"

function output(name: string, extra: Partial<Output> = {}): Output {
    return { enabled: true, active: false, name, color: "#fff", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, screen: null, ...extra }
}

beforeEach(() => {
    setOutputs({ one: output("one"), two: output("two"), three: output("three") })
})

describe("outputs domain module", () => {
    it("exposes a read-only store: no set/update on the public store", () => {
        expect(typeof outputs.subscribe).toBe("function")
        expect((outputs as any).set).toBeUndefined()
        expect((outputs as any).update).toBeUndefined()
    })

    it("get(outputs) and getOutput(id) read the current record", () => {
        expect(Object.keys(get(outputs))).toEqual(["one", "two", "three"])
        expect(getOutput("two")?.name).toBe("two")
        expect(getOutput("nope")).toBeUndefined()
    })

    it("updateOutputs accepts in-place mutation and notifies once per real change", () => {
        const run = vi.fn()
        outputs.subscribe(run)
        run.mockClear()
        updateOutputs((all) => {
            all.two.out = { slide: { id: "s", index: 0 } } as any
            return all
        })
        expect(run).toHaveBeenCalledTimes(1)
        expect(getOutput("two")?.out).toBeDefined()
        updateOutputs((all) => all)
        expect(run).toHaveBeenCalledTimes(1)
    })

    it("patchOutput changes one output and leaves the others untouched by reference", () => {
        const before = get(outputs)
        patchOutput("two", { enabled: false })
        const after = get(outputs)
        expect(after.two.enabled).toBe(false)
        expect(after.one).toBe(before.one)
        expect(after.three).toBe(before.three)
    })

    it("patchOutput accepts an updater and ignores unknown ids", () => {
        patchOutput("one", (current) => ({ ...current, name: "renamed" }))
        patchOutput("ghost", { name: "x" })
        expect(getOutput("one")?.name).toBe("renamed")
        expect(getOutput("ghost")).toBeUndefined()
    })

    it("removeOutput deletes an output", () => {
        removeOutput("one")
        expect(Object.keys(get(outputs))).toEqual(["two", "three"])
    })

    it("setOutputs with equal data does not notify subscribers", () => {
        const run = vi.fn()
        outputs.subscribe(run)
        run.mockClear()
        setOutputs(JSON.parse(JSON.stringify(get(outputs))))
        expect(run).not.toHaveBeenCalled()
    })

    it("selectOutput(id) only runs for that output", () => {
        const runOne = vi.fn()
        const runTwo = vi.fn()
        const stopOne = selectOutput("one").subscribe(runOne)
        const stopTwo = selectOutput("two").subscribe(runTwo)
        flushSync()
        runOne.mockClear()
        runTwo.mockClear()
        patchOutput("two", { active: true })
        flushSync()
        expect(runOne).not.toHaveBeenCalled()
        expect(runTwo).toHaveBeenCalledTimes(1)
        stopOne()
        stopTwo()
    })

    it("writableOutputs (generic store map entry) writes through the same module state", () => {
        writableOutputs.update((all) => {
            all.one.name = "via generic"
            return all
        })
        expect(getOutput("one")?.name).toBe("via generic")
        writableOutputs.set({ solo: output("solo") })
        expect(Object.keys(get(outputs))).toEqual(["solo"])
    })
})
