import { describe, expect, it } from "vitest"
import { backgroundWithToggle } from "./mediaControlsBackground"

describe("operator media toggle background", () => {
    const background = { path: "/media/a.mp4", type: "video", muted: false, loop: false, startAt: 0 }

    it("applies the toggled flag", () => {
        expect(backgroundWithToggle(background, { loop: true })).toMatchObject({ path: "/media/a.mp4", loop: true, muted: false })
    })

    it("drops startAt so setOutput does not seek the playing video back", () => {
        expect("startAt" in backgroundWithToggle(background, { loop: true })).toBe(false)
    })

    it("does not mutate the stored background", () => {
        backgroundWithToggle(background, { loop: true })
        expect(background).toEqual({ path: "/media/a.mp4", type: "video", muted: false, loop: false, startAt: 0 })
    })
})
