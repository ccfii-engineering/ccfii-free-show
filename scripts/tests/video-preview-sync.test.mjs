import assert from "node:assert/strict"
import { test } from "node:test"
import { getPreviewVideoSyncUpdate } from "../../src/frontend/components/output/videoPreviewSync.ts"

test("keeps preview playing when output loops back to the start while playing", () => {
    assert.deepEqual(
        getPreviewVideoSyncUpdate({
            fadingOut: false,
            localPaused: false,
            localTime: 9.8,
            remotePaused: false,
            remoteTime: 0.1
        }),
        { time: 0.1, paused: false }
    )
})

test("unpauses a preview that was previously paused at the loop boundary", () => {
    assert.deepEqual(
        getPreviewVideoSyncUpdate({
            fadingOut: false,
            localPaused: true,
            localTime: 0,
            remotePaused: false,
            remoteTime: 0.7
        }),
        { time: 0.7, paused: false }
    )
})

test("does not seek an already-playing preview during the first two seconds unless it is out of range", () => {
    assert.equal(
        getPreviewVideoSyncUpdate({
            fadingOut: false,
            localPaused: false,
            localTime: 1,
            remotePaused: false,
            remoteTime: 1.3
        }),
        null
    )
})

test("does not chase normal forward drift while preview is already playing", () => {
    assert.equal(
        getPreviewVideoSyncUpdate({
            fadingOut: false,
            localPaused: false,
            localTime: 3,
            remotePaused: false,
            remoteTime: 3.8
        }),
        null
    )
})

test("seeks a playing preview when it is far behind the output", () => {
    assert.deepEqual(
        getPreviewVideoSyncUpdate({
            fadingOut: false,
            localPaused: false,
            localTime: 3,
            remotePaused: false,
            remoteTime: 5.5
        }),
        { time: 5.5, paused: false }
    )
})
