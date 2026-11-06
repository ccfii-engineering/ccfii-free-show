import { writable } from "svelte/store"
import { describe, expect, it, vi } from "vitest"
import type { Media } from "../../types/Main"
import type { Show, Shows } from "../../types/Show"
import { media, selectMediaEntry, setMedia, updateMedia } from "../mediaState/media.svelte"
import { selectCachedShow, setShowsCache, showsCache, updateShowsCache } from "../showsCacheState/showsCache.svelte"
import { createEntryAccessor } from "./perEntryStoresFactory"

/**
 * Measurement for #76 (same method as outputs.measurement.test.ts): subscriber runs caused by writes to ONE entry.
 *
 * 4 entries, 4 subscribers that each care about one entry (what MediaCard, Slide, Textbox ... do with `$media[path]` /
 * `$showsCache[id]`), plus 2 whole-record subscribers (persistence, drawers).
 * Counting every callback invocation after the initial delivery.
 *  - before: the old `writable<Record>` with `update(a => { mutate; return a })`. Every write notifies every subscriber.
 *  - after:  the domain module. Per-entry subscribers use the selectors; whole-record subscribers use `.subscribe`.
 */

const IDS = ["a", "b", "c", "d"]
const WHOLE = 2

type Update<R> = (fn: (a: R) => R) => void

function measure<R>(before: { seed: () => R; update: (store: ReturnType<typeof writable<R>>, fn: (a: R) => R) => void }, after: { seed: () => void; selectors: (() => (cb: () => void) => () => void)[]; whole: (cb: () => void) => () => void; update: Update<R> }, writes: (update: Update<R>) => void) {
    const store = writable<R>(before.seed())
    let beforeRuns = 0
    for (let i = 0; i < IDS.length + WHOLE; i++) store.subscribe(() => beforeRuns++)
    beforeRuns = 0
    writes((fn) => before.update(store, fn))

    after.seed()
    let afterRuns = 0
    const stops = [...after.selectors.map((select) => select()(() => afterRuns++)), ...Array.from({ length: WHOLE }, () => after.whole(() => afterRuns++))]
    afterRuns = 0
    writes(after.update)
    stops.forEach((stop) => stop())
    return { before: beforeRuns, after: afterRuns }
}

function scenarios<R>(entry: (a: R) => { x: number }) {
    return {
        one: (update: Update<R>) =>
            update((a) => {
                entry(a).x = 1
                return a
            }),
        burst: (update: Update<R>) => {
            for (const x of [1, 2, 3])
                update((a) => {
                    entry(a).x = x
                    return a
                })
        },
        noop: (update: Update<R>) =>
            update((a) => {
                void entry(a)
                return a
            })
    }
}

// ---- media: entries keyed by path ----
const MEDIA_PATHS = IDS.map((id) => `/media/${id}.mp4`)
const mediaSeed = (): Media => Object.fromEntries(MEDIA_PATHS.map((path) => [path, { fit: "cover" as const, x: 0 } as any]))
const mediaMeasure = (writes: (update: Update<Media>) => void) =>
    measure<Media>(
        { seed: mediaSeed, update: (store, fn) => store.update(fn) },
        {
            seed: () => setMedia(mediaSeed()),
            selectors: MEDIA_PATHS.map((path) => () => selectMediaEntry(path).subscribe),
            whole: (cb) => media.subscribe(cb),
            update: (fn) => updateMedia(fn)
        },
        writes
    )
const mediaScenarios = scenarios<Media>((a) => a[MEDIA_PATHS[1]] as any)

// ---- shows cache: entries keyed by show id ----
const show = (id: string): Show => ({ name: id, category: null, settings: {}, timestamps: { created: 0, modified: null, used: null }, meta: {}, slides: {}, layouts: {}, media: {}, x: 0 }) as any
const showsSeed = (): Shows => Object.fromEntries(IDS.map((id) => [id, show(id)]))
const showsMeasure = (writes: (update: Update<Shows>) => void) =>
    measure<Shows>(
        { seed: showsSeed, update: (store, fn) => store.update(fn) },
        {
            seed: () => setShowsCache(showsSeed()),
            selectors: IDS.map((id) => () => selectCachedShow(id).subscribe),
            whole: (cb) => showsCache.subscribe(cb),
            update: (fn) => updateShowsCache(fn)
        },
        writes
    )
const showScenarios = scenarios<Shows>((a) => a.b as any)

const expected = {
    one: { before: 6, after: 3 }, // 1 selector + 2 whole-record subscribers
    burst: { before: 18, after: 9 }, // 3 real writes x (1 selector + 2 whole)
    noop: { before: 6, after: 0 }
}

describe.each([
    ["media", mediaMeasure, mediaScenarios],
    ["showsCache", showsMeasure, showScenarios]
] as const)("%s: subscriber runs for a single-entry change", (_name, run, cases: any) => {
    for (const key of ["one", "burst", "noop"] as const) {
        it(`${key}: ${expected[key].before} runs before, ${expected[key].after} after`, () => {
            const result = run(cases[key])
            expect(result).toEqual(expected[key])
            expect(result.after).toBeLessThanOrEqual(result.before)
        })
    }
})

describe("per-entry gate cost and whole-record copies", () => {
    it("old JSON-gate accessor evaluates (JSON.stringify) once per show per write to wake 1 subscriber; selectors evaluate none", () => {
        const source = writable<Shows>(showsSeed())
        let evaluations = 0
        const counted = { subscribe: (run: (v: Shows) => void) => source.subscribe((v) => (evaluations++, run(v))), set: source.set, update: source.update }
        const accessor = createEntryAccessor(counted)
        let subscriberRuns = 0
        IDS.forEach((id) => accessor(id).subscribe(() => subscriberRuns++))
        evaluations = 0
        subscriberRuns = 0
        source.update((a) => {
            a.b.x = 1 as never
            return a
        })
        expect({ evaluations, subscriberRuns }).toEqual({ evaluations: 4, subscriberRuns: 1 })
    })

    it("an edit to one show copies one show, not the whole cache (old update deep-copied every show)", () => {
        const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`s${i}`, show(`s${i}`)])) as Shows
        const copies = vi.spyOn(globalThis, "structuredClone")

        setShowsCache(many)
        copies.mockClear()
        updateShowsCache((a) => {
            a.s7.name = "edited"
            return a
        })
        const after = copies.mock.calls.length

        // before: the old module-less pattern, `update` handed out a structuredClone of the whole record (one top-level call
        // that copies all 50 shows). Count the shows copied instead of the calls.
        const copiedBefore = Object.keys(structuredClone(many)).length
        copies.mockRestore()
        expect({ showsCopiedBefore: copiedBefore, showsCopiedAfter: after }).toEqual({ showsCopiedBefore: 50, showsCopiedAfter: 1 })
    })
})
