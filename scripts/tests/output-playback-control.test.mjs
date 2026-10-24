import assert from "node:assert/strict"
import { test } from "node:test"
import { findPlayingEntry, getMatchingLinkedOutputs, makeOutputVideoData, makeOutputVideoTime, mergeOutputVideoData, OutputPlaybackControl, readOutputVideoTime, resolveOutputPaused } from "../../src/frontend/components/media/video/outputPlaybackControl.ts"

const outputs = {
    outA: { out: { background: { path: "/media/shared.webm" } } },
    outB: { out: { background: { id: "/media/shared.webm" } } },
    outC: { out: { background: { path: "/media/replaced.webm" } } },
    outD: { out: { background: { path: "/media/shared.webm" } } }
}

test("selected audio entry determines the linked output set for same-path media", () => {
    const sharedEntry = { path: "/media/shared.webm", linkedOutputIds: ["outA", "outB", "outC"] }
    const independentSamePathEntry = { path: "/media/shared.webm", linkedOutputIds: ["outD"] }
    const entries = [independentSamePathEntry, sharedEntry]

    assert.equal(findPlayingEntry(entries, sharedEntry.path, ["outA"]), sharedEntry)
    assert.equal(findPlayingEntry(entries, sharedEntry.path, ["outD"]), independentSamePathEntry)
    assert.equal(findPlayingEntry(entries, sharedEntry.path, ["unlinked"]), null)
    assert.deepEqual(getMatchingLinkedOutputs(sharedEntry.path, sharedEntry.linkedOutputIds, outputs), ["outA", "outB"])
})

test("missing requested pause state preserves the audio element's actual post-operation state", () => {
    assert.equal(resolveOutputPaused(undefined, false), false)
    assert.equal(resolveOutputPaused(undefined, true), true)
    assert.equal(resolveOutputPaused(true, false), true)
    assert.equal(resolveOutputPaused(false, true), false)
})

test("legacy DATA merges omitted fields instead of erasing the current paused state", () => {
    const current = { duration: 8, paused: true, muted: true, loop: false }
    assert.deepEqual(mergeOutputVideoData(current, { muted: false, loop: true }, "/media/a.webm"), { duration: 8, paused: true, muted: false, loop: true })
})

test("identity-tagged DATA applies to its current media and rejects stale media", () => {
    const current = { duration: 8, paused: true }
    const command = makeOutputVideoData("/media/shared.webm", { paused: false })
    assert.deepEqual(mergeOutputVideoData(current, command, "/media/shared.webm"), { duration: 8, paused: false })
    assert.equal(mergeOutputVideoData(current, command, "/media/replaced.webm"), null)
})

test("identity-tagged TIME accepts zero and rejects stale media", () => {
    const seekToStart = makeOutputVideoTime("/media/shared.webm", 0)
    assert.equal(readOutputVideoTime(seekToStart, "/media/shared.webm"), 0)
    assert.equal(readOutputVideoTime(seekToStart, "/media/replaced.webm"), undefined)
    assert.equal(readOutputVideoTime(0, "/media/shared.webm"), 0)
    assert.equal(readOutputVideoTime(undefined, "/media/shared.webm"), undefined)
})

test("commands mutate the selected entry and publish only to linked outputs still showing it", () => {
    const entryA = { path: "/media/shared.webm", linkedOutputIds: ["outA", "outB", "outC"], muted: false, type: "background" }
    const entryD = { path: "/media/shared.webm", linkedOutputIds: ["outD"], muted: false, type: "background" }
    const entries = [entryA, entryD]
    const sent = []
    const control = new OutputPlaybackControl({ getEntries: () => entries, getOutputs: () => outputs, send: (...args) => sent.push(args) })

    assert.equal(
        control.execute(entryA.path, "outA", (selection) => {
            selection.entry.muted = true
            control.publishData(selection, { muted: selection.entry.muted })
        }),
        true
    )
    assert.equal(entryA.muted, true)
    assert.equal(entryD.muted, false)
    assert.deepEqual(sent, [["DATA", { outA: { identity: entryA.path, muted: true }, outB: { identity: entryA.path, muted: true } }]])
})

test("stale requested background rejects before mutating a shared entry still linked elsewhere", () => {
    const entry = { path: "/media/shared.webm", linkedOutputIds: ["outA", "outB"], muted: false, type: "background" }
    const currentOutputs = {
        outA: { out: { background: { path: "/media/replaced.webm" } } },
        outB: { out: { background: { path: entry.path } } }
    }
    const sent = []
    const control = new OutputPlaybackControl({ getEntries: () => [entry], getOutputs: () => currentOutputs, send: (...args) => sent.push(args) })

    assert.equal(
        control.execute(entry.path, "outA", (selection) => {
            selection.entry.muted = true
            control.publishData(selection, { muted: true })
        }),
        false
    )
    assert.equal(entry.muted, false)
    assert.deepEqual(sent, [])
})

test("a missing audio entry permits identity-matched native pause, mute, and seek to zero", () => {
    const sent = []
    const control = new OutputPlaybackControl({ getEntries: () => [], getOutputs: () => outputs, send: (...args) => sent.push(args) })

    assert.equal(
        control.execute("/media/shared.webm", "outA", (selection) => control.publishData(selection, { paused: true })),
        true
    )
    assert.equal(
        control.execute("/media/shared.webm", "outB", (selection) => control.publishData(selection, { muted: true })),
        true
    )
    assert.equal(
        control.execute("/media/shared.webm", "outB", (selection) => control.publishTime(selection, 0)),
        true
    )
    assert.deepEqual(sent, [
        ["DATA", { outA: { identity: "/media/shared.webm", paused: true } }],
        ["DATA", { outB: { identity: "/media/shared.webm", muted: true } }],
        ["TIME", { outB: { identity: "/media/shared.webm", time: 0 } }]
    ])
    assert.equal(
        control.execute("/media/replaced.webm", "outA", () => assert.fail("stale target must not execute")),
        false
    )
})

test("item entries keep their legacy audio ownership and never receive background commands", () => {
    const item = { path: "/media/shared.webm", linkedOutputIds: ["outA"], muted: false, type: "item" }
    const sent = []
    const control = new OutputPlaybackControl({ getEntries: () => [item], getOutputs: () => outputs, send: (...args) => sent.push(args) })

    assert.equal(
        control.execute(item.path, "outA", (selection) => {
            selection.entry.muted = true
            control.publishData(selection, { muted: true })
        }),
        true
    )
    assert.equal(item.muted, true)
    assert.deepEqual(sent, [])
})

test("delayed startup requires the exact entry and at least one surviving linked background", () => {
    const entry = { path: "/media/shared.webm", linkedOutputIds: ["outA", "outB"], type: "background" }
    const currentOutputs = {
        outA: { out: { background: { path: entry.path } } },
        outB: { out: { background: { path: entry.path } } }
    }
    const entries = [entry]
    const control = new OutputPlaybackControl({ getEntries: () => entries, getOutputs: () => currentOutputs, send: () => {} })

    assert.equal(control.isCurrentEntry(entry, ["outA", "outB"]), true)
    currentOutputs.outB.out.background.path = "/media/replaced.webm"
    assert.equal(control.isCurrentEntry(entry, ["outA", "outB"]), true)
    assert.deepEqual(control.getCurrentLinkedOutputIds(entry.path, entry.linkedOutputIds), ["outA"])
    currentOutputs.outA.out.background.path = "/media/replaced.webm"
    assert.equal(control.isCurrentEntry(entry, ["outA", "outB"]), false)
    currentOutputs.outA.out.background.path = entry.path
    currentOutputs.outB.out.background.path = entry.path
    entries.splice(0, 1)
    assert.equal(control.isCurrentEntry(entry, ["outA", "outB"]), false)
})

test("absolute loop publication updates only the requested output of a shared audio entry", () => {
    const entry = { path: "/media/shared.webm", linkedOutputIds: ["outA", "outB"], type: "background" }
    const sent = []
    const control = new OutputPlaybackControl({ getEntries: () => [entry], getOutputs: () => outputs, send: (...args) => sent.push(args) })
    const selection = control.select(entry.path, "outA")

    assert.ok(selection)
    control.publishData(selection, { loop: false }, ["outA"])
    assert.deepEqual(sent, [["DATA", { outA: { identity: entry.path, loop: false } }]])
})
