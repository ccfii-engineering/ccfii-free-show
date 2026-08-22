import assert from "node:assert/strict"
import test from "node:test"
import { applyPlaybackReport, clearOutputPlayback, emptyPlaybackState, normalizePlaybackReport } from "../../src/frontend/outputState/playbackState.ts"

const visualReport = (overrides = {}) => normalizePlaybackReport({ outputId: "default", sourceId: "gpu-a", role: "visual", identity: "/media/a.webm", duration: 10, progress: 1, paused: false, loop: true, muted: true, ...overrides })

test("normalizes and rejects malformed reports", () => {
    assert.equal(normalizePlaybackReport(null), null)
    assert.equal(normalizePlaybackReport({}), null)
    assert.equal(normalizePlaybackReport({ outputId: "", sourceId: "x", role: "visual" }), null)
    assert.equal(normalizePlaybackReport({ outputId: "a", sourceId: "", role: "visual" }), null)
    assert.equal(normalizePlaybackReport({ outputId: "a", sourceId: "x", role: "other" }), null)

    const normalized = normalizePlaybackReport({ outputId: "a", sourceId: "x", role: "visual", duration: "12", progress: -5, paused: 1, loop: true })
    assert.equal(normalized.duration, 12)
    assert.equal(normalized.progress, -5)
    assert.equal(normalized.paused, undefined)
    assert.equal(normalized.loop, true)
})

test("first visual source claims ownership and creates the snapshot", () => {
    const state = applyPlaybackReport(emptyPlaybackState(), visualReport())
    const snapshot = state.snapshots.default
    assert.equal(snapshot.generation, "gpu-a")
    assert.equal(snapshot.duration, 10)
    assert.equal(snapshot.progress, 1)
    assert.equal(state.activeVisual.default, "gpu-a")
})

test("a newer visual source supersedes the previous owner and its late reports are rejected", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport())
    state = applyPlaybackReport(state, visualReport({ sourceId: "gpu-b", identity: "/media/b.webm", progress: 2 }))
    assert.equal(state.activeVisual.default, "gpu-b")
    assert.equal(state.snapshots.default.identity, "/media/b.webm")
    assert.equal(state.snapshots.default.progress, 2)

    // outgoing generation cannot overwrite the active video's state
    const stale = applyPlaybackReport(state, visualReport({ progress: 9 }))
    assert.equal(stale, state)
    assert.equal(stale.snapshots.default.progress, 2)
})

test("sync publishers merge fields but never take visual ownership", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport({ progress: 3 }))
    state = applyPlaybackReport(state, visualReport({ sourceId: "sync-1", role: "sync", progress: 4, duration: 12 }))
    assert.equal(state.activeVisual.default, "gpu-a")
    assert.equal(state.snapshots.default.generation, "gpu-a")
    assert.equal(state.snapshots.default.progress, 4)
    assert.equal(state.snapshots.default.duration, 12)
})

test("reports with a conflicting media identity are dropped", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport({ identity: "/media/a.webm" }))
    const before = state
    state = applyPlaybackReport(state, visualReport({ sourceId: "sync-1", role: "sync", identity: "/media/OTHER.webm", progress: 7 }))
    assert.equal(state, before)
})

test("wrap events reset observable progress even between throttled updates", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport({ duration: 1.5, progress: 1.4 }))
    state = applyPlaybackReport(state, visualReport({ progress: 0.05, event: "wrap" }))
    assert.equal(state.snapshots.default.progress, 0.05)
    assert.ok(state.snapshots.default.lastWrapAt !== null)
})

test("clearing removes stale duration and progress and stops late publisher reports", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport())
    state = clearOutputPlayback(state, "default")
    assert.equal(state.snapshots.default, undefined)
    assert.equal(state.activeVisual.default, undefined)

    const late = applyPlaybackReport(state, visualReport({ progress: 8 }))
    assert.equal(late.snapshots.default, undefined)
})

test("a cleared output accepts a brand new renderer session again", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport())
    state = clearOutputPlayback(state, "default")
    state = applyPlaybackReport(state, visualReport({ sourceId: "gpu-c", identity: "/media/c.webm", progress: 0.5 }))
    assert.equal(state.snapshots.default.generation, "gpu-c")
    assert.equal(state.snapshots.default.progress, 0.5)
})

test("two outputs never overwrite one another's snapshots", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport())
    state = applyPlaybackReport(state, visualReport({ outputId: "second", sourceId: "gpu-x", identity: "/media/x.webm", progress: 5 }))

    state = applyPlaybackReport(state, visualReport({ outputId: "second", progress: 6 }))
    assert.equal(state.snapshots.default.progress, 1)
    assert.equal(state.snapshots.second.progress, 6)

    state = clearOutputPlayback(state, "second")
    assert.equal(state.snapshots.second, undefined)
    assert.ok(state.snapshots.default.duration === 10)
})

test("media replacement on the same publisher adopts the new resource wholesale (#18)", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport({ identity: "/media/a.webm", duration: 1.5, progress: 1.2, loop: true }))

    // video B replaces A on the same output mount: metadata must reflect B, not bleed into A
    state = applyPlaybackReport(state, visualReport({ identity: "/media/b.webm", duration: 3, progress: 0.01, loop: false }))
    assert.equal(state.snapshots.default.identity, "/media/b.webm")
    assert.equal(state.snapshots.default.duration, 3)
    assert.equal(state.snapshots.default.progress, 0.01)
    assert.equal(state.snapshots.default.loop, false)
    assert.equal(state.snapshots.default.lastWrapAt, null)

    // ongoing B reports merge normally afterwards
    state = applyPlaybackReport(state, visualReport({ identity: "/media/b.webm", duration: 3, progress: 0.5 }))
    assert.equal(state.snapshots.default.identity, "/media/b.webm")
    assert.equal(state.snapshots.default.progress, 0.5)
})

test("a wrap published with the replacement report keeps its observable reset (#18)", () => {
    let state = applyPlaybackReport(emptyPlaybackState(), visualReport({ identity: "/media/a.webm", duration: 1.5, progress: 1.4 }))
    state = applyPlaybackReport(state, visualReport({ identity: "/media/b.webm", duration: 2, progress: 0, event: "wrap" }))
    assert.equal(state.snapshots.default.identity, "/media/b.webm")
    assert.equal(state.snapshots.default.progress, 0)
    assert.ok(state.snapshots.default.lastWrapAt !== null)
})
