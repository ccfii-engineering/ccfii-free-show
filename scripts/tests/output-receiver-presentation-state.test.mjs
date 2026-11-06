import assert from "node:assert/strict"
import { test } from "node:test"

import { applyPlayingVideoAudio, filterLiveBackgroundUpdates, mergeOutputStates, outputsToClearOnDeactivate } from "../../src/frontend/outputState/receiverPresentationState.ts"

const live = { out: { background: { path: "a.mp4" } }, enabled: true }

test("late time/data for a cleared or missing background is dropped (#16/#18)", () => {
    const outputs = { one: live, two: { out: { background: null } }, three: { out: { background: {} } } }
    assert.deepEqual(filterLiveBackgroundUpdates({ one: 1, two: 2, three: 3, ghost: 4 }, outputs), { one: 1 })
    assert.equal(filterLiveBackgroundUpdates({ two: 2 }, outputs), null)
})

test("background with only an id counts as live", () => {
    assert.deepEqual(filterLiveBackgroundUpdates({ one: 1 }, { one: { out: { background: { id: "x" } } } }), { one: 1 })
})

test("non-object messages are rejected", () => {
    assert.equal(filterLiveBackgroundUpdates(null, {}), null)
    assert.equal(filterLiveBackgroundUpdates("x", {}), null)
})

test("deactivating an output with a background requests a clear (#19)", () => {
    const outputs = { one: live, two: { out: {} }, three: live }
    const states = [
        { id: "one", active: false },
        { id: "two", active: false },
        { id: "three", active: true },
        { id: "gone", active: false }
    ]
    assert.deepEqual(outputsToClearOnDeactivate(states, outputs), ["one"])
})

test("invisible is not a deactivation", () => {
    assert.deepEqual(outputsToClearOnDeactivate([{ id: "one", active: "invisible" }], { one: live }), [])
})

test("merge replaces by id, appends new, drops disabled and invisible outputs", () => {
    const outputs = { a: { enabled: true }, b: { enabled: true }, c: { enabled: false }, d: { enabled: true, invisible: true } }
    const current = [{ id: "a", active: false }]
    const { states } = mergeOutputStates(
        current,
        [
            { id: "a", active: true },
            { id: "b", active: true },
            { id: "c", active: true },
            { id: "d", active: true }
        ],
        outputs
    )
    assert.deepEqual(states, [
        { id: "a", active: true },
        { id: "b", active: true }
    ])
    assert.deepEqual(current, [{ id: "a", active: false }])
})

test("display state is set only when all boolean states agree", () => {
    const outputs = { a: { enabled: true }, b: { enabled: true } }
    const merge = (...states) => mergeOutputStates([], states, outputs).display
    assert.equal(merge({ id: "a", active: true }, { id: "b", active: true }), true)
    assert.equal(merge({ id: "a", active: false }, { id: "b", active: false }), false)
    assert.equal(merge({ id: "a", active: true }, { id: "b", active: false }), undefined)
    assert.equal(merge({ id: "a", active: true }, { id: "b", active: "invisible" }), true)
    assert.equal(merge({ id: "a", active: "invisible" }), undefined)
})

test("audio report tracks a playing video only for outputs with a background", () => {
    const outputs = { one: live, two: { out: {} } }
    assert.deepEqual(applyPlayingVideoAudio([], { id: "one", t: 1 }, outputs), [{ location: "output", id: "one", t: 1 }])
    assert.deepEqual(applyPlayingVideoAudio([], { id: "two" }, outputs), [])
})

test("audio report updates an existing entry and stop removes it", () => {
    const outputs = { two: { out: {} } }
    const existing = [{ id: "two", t: 1 }, { id: "x" }]
    assert.deepEqual(applyPlayingVideoAudio(existing, { id: "two", t: 2 }, outputs), [{ id: "two", t: 2, location: "output" }, { id: "x" }])
    assert.deepEqual(applyPlayingVideoAudio(existing, { id: "two", stop: true }, outputs), [{ id: "x" }])
    assert.deepEqual(existing, [{ id: "two", t: 1 }, { id: "x" }])
    assert.deepEqual(applyPlayingVideoAudio([{ id: "x" }], { id: "two", stop: true }, outputs), [{ id: "x" }])
})
