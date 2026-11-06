import { flushSync } from "svelte"
import { writable } from "svelte/store"
import { describe, expect, it } from "vitest"
import type { Output, Outputs } from "../../types/Output"
import { createEntryAccessor } from "../utils/perEntryStoresFactory"
import { outputs, patchOutput, selectOutput, setOutputs, updateOutputs } from "./outputs.svelte"

/**
 * Measurement for #75: subscriber runs caused by writes to ONE output.
 *
 * Method: 4 outputs, 4 subscribers that each care about one output (what Output.svelte, previews and playback
 * observers do: `$outputs[id]`), plus 2 whole-record subscribers (e.g. persistence, audio routing).
 * Counting every callback invocation after the initial delivery.
 *  - before: the old `writable<Outputs>` with `update(a => { mutate; return a })`. Every write notifies every subscriber.
 *  - after:  this module. Per-output subscribers use selectOutput(id); whole-record subscribers use outputs.subscribe.
 */

const IDS = ["a", "b", "c", "d"]
const WHOLE = 2

function make(id: string): Output {
    return { enabled: true, active: false, name: id, color: "#fff", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, screen: null }
}
const record = (): Outputs => Object.fromEntries(IDS.map((id) => [id, make(id)]))

function measureBefore(writes: (update: (fn: (a: Outputs) => Outputs) => void) => void) {
    const store = writable<Outputs>(record())
    let runs = 0
    for (let i = 0; i < IDS.length; i++) store.subscribe(() => runs++)
    for (let i = 0; i < WHOLE; i++) store.subscribe(() => runs++)
    runs = 0
    writes((fn) => store.update(fn))
    return runs
}

function measureAfter(writes: (update: (fn: (a: Outputs) => Outputs) => void) => void) {
    setOutputs(record())
    let runs = 0
    const stops = [...IDS.map((id) => selectOutput(id).subscribe(() => runs++)), ...Array.from({ length: WHOLE }, () => outputs.subscribe(() => runs++))]
    flushSync()
    runs = 0
    writes((fn) => updateOutputs(fn))
    flushSync()
    stops.forEach((stop) => stop())
    return runs
}

const scenarios: { name: string; writes: (update: (fn: (a: Outputs) => Outputs) => void) => void; before: number; after: number }[] = [
    {
        name: "one output changes (set slide)",
        writes: (update) =>
            update((a) => {
                a.b.active = true
                return a
            }),
        before: 6,
        after: 3 // 1 selector + 2 whole-record subscribers
    },
    {
        name: "burst of 3 real writes to one output (slide, transition, clear)",
        writes: (update) => {
            update((a) => {
                a.b.active = true
                return a
            })
            update((a) => {
                a.b.name = "x"
                return a
            })
            update((a) => {
                a.b.name = "b"
                return a
            })
        },
        before: 18,
        after: 9 // 3 selector runs (each write really changed the output) + whole-record: 3 writes x 2
    },
    {
        name: "write that changes nothing (e.g. clear on an already clear output)",
        writes: (update) =>
            update((a) => {
                if (a.b?.name === "never") a.b.active = true
                return a
            }),
        before: 6,
        after: 0
    }
]

describe("outputs: subscriber runs for a single-output change", () => {
    for (const scenario of scenarios) {
        it(`${scenario.name}: ${scenario.before} runs before, ${scenario.after} after`, () => {
            const before = measureBefore(scenario.writes)
            const after = measureAfter(scenario.writes)
            expect({ before, after }).toEqual({ before: scenario.before, after: scenario.after })
            expect(after).toBeLessThan(before)
        })
    }

    it("old per-entry derived accessor: 1 subscriber run but every write is re-evaluated (JSON-stringified) once per output", () => {
        const source = writable<Outputs>(record())
        let evaluations = 0
        const counted = { subscribe: (run: (v: Outputs) => void) => source.subscribe((v) => (evaluations++, run(v))), set: source.set, update: source.update }
        const accessor = createEntryAccessor(counted)
        let subscriberRuns = 0
        IDS.forEach((id) => accessor(id).subscribe(() => subscriberRuns++))
        evaluations = 0
        subscriberRuns = 0
        source.update((a) => {
            a.b.active = true
            return a
        })
        // 4 gate evaluations to wake 1 subscriber; the rune selectors do 0 whole-record evaluations (see test below)
        expect({ evaluations, subscriberRuns }).toEqual({ evaluations: 4, subscriberRuns: 1 })
    })

    it("a single patchOutput wakes exactly one per-output subscriber", () => {
        setOutputs(record())
        const runs: Record<string, number> = {}
        const stops = IDS.map((id) => selectOutput(id).subscribe(() => (runs[id] = (runs[id] || 0) + 1)))
        flushSync()
        IDS.forEach((id) => (runs[id] = 0))
        patchOutput("c", { active: true })
        flushSync()
        expect(runs).toEqual({ a: 0, b: 0, c: 1, d: 0 })
        stops.forEach((stop) => stop())
    })
})
