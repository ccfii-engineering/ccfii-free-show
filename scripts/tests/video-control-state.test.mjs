import assert from "node:assert/strict"
import { test } from "node:test"
import { applyVideoControlData, getVideoControlSnapshot, isVideoTimeReset } from "../../src/frontend/components/output/webgpu/videoControlState.ts"

function createVideo(overrides = {}) {
    return {
        currentTime: 3,
        duration: 20,
        paused: false,
        loop: false,
        muted: true,
        playCalls: 0,
        pauseCalls: 0,
        play() {
            this.playCalls += 1
            this.paused = false
            return Promise.resolve()
        },
        pause() {
            this.pauseCalls += 1
            this.paused = true
        },
        ...overrides
    }
}

test("applies loop, mute, and seek control data to a video element", () => {
    const video = createVideo()

    applyVideoControlData(video, { loop: true, muted: false, currentTime: 12 })

    assert.equal(video.loop, true)
    assert.equal(video.muted, false)
    assert.equal(video.currentTime, 12)
})

test("applies pause and play control data to a video element", async () => {
    const video = createVideo()

    await applyVideoControlData(video, { paused: true })
    assert.equal(video.paused, true)
    assert.equal(video.pauseCalls, 1)

    await applyVideoControlData(video, { paused: false })
    assert.equal(video.paused, false)
    assert.equal(video.playCalls, 1)
})

test("reports the full video control snapshot including loop and mute", () => {
    const video = createVideo({ currentTime: 7, duration: Number.POSITIVE_INFINITY, paused: true, loop: true, muted: false })

    assert.deepEqual(getVideoControlSnapshot(video), {
        currentTime: 7,
        duration: 0,
        paused: true,
        loop: true,
        muted: false
    })
})

test("detects video time resets so loop restarts can bypass throttling", () => {
    assert.equal(isVideoTimeReset(0, 19.8), true)
    assert.equal(isVideoTimeReset(19.6, 19.8), false)
    assert.equal(isVideoTimeReset(20, Number.NaN), false)
})
