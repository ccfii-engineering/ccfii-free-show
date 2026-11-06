import { describe, expect, it } from "vitest"
import { createSeekTracker } from "./outputSeekTracker"

describe("output seek tracker", () => {
    it("reports a seek made after the reference time", () => {
        let now = 1000
        const tracker = createSeekTracker(() => now)
        const requestedAt = tracker.now()
        now = 1300
        tracker.markSeek("out1")
        expect(tracker.seekedSince("out1", requestedAt)).toBe(true)
    })

    it("ignores a seek made before the reference time", () => {
        let now = 1000
        const tracker = createSeekTracker(() => now)
        tracker.markSeek("out1")
        now = 1100
        const requestedAt = tracker.now()
        expect(tracker.seekedSince("out1", requestedAt)).toBe(false)
    })

    it("ignores seeks on other outputs and outputs never seeked", () => {
        let now = 1000
        const tracker = createSeekTracker(() => now)
        const requestedAt = tracker.now()
        now = 1200
        tracker.markSeek("out2")
        expect(tracker.seekedSince("out1", requestedAt)).toBe(false)
    })
})
