import { describe, expect, it } from "vitest"
import type { Output } from "../../../../types/Output"
import { outputWithBackgroundFlag } from "./mediaControlsBackground"

describe("operator media toggle", () => {
    const output = { id: "o1", out: { slide: null, background: { path: "/media/a.mp4", type: "video", muted: false, loop: false, startAt: 0 } } } as unknown as Output

    it("applies the toggled flag to the stored background and keeps the rest", () => {
        const next = outputWithBackgroundFlag(output, { loop: true })
        expect(next.out?.background).toEqual({ path: "/media/a.mp4", type: "video", muted: false, loop: true, startAt: 0 })
        expect(next.out?.slide).toBeNull()
    })

    it("does not mutate the stored output", () => {
        outputWithBackgroundFlag(output, { loop: true })
        expect(output.out?.background?.loop).toBe(false)
    })

    it("returns the output unchanged when nothing is playing", () => {
        const idle = { id: "o2", out: {} } as unknown as Output
        expect(outputWithBackgroundFlag(idle, { loop: true })).toBe(idle)
    })
})
