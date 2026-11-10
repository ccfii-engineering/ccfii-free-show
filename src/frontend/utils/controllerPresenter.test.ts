import { describe, expect, it } from "vitest"
import { getDrawSpace, resolvePresenterStyleLines, windowOffsetToSlide } from "./controllerPresenter"

describe("controller preview output style projection", () => {
    const defaultLayers = ["background", "slide", "overlays"]

    it("provides the active output's line window and suppresses it when slide output is disabled", () => {
        expect(resolvePresenterStyleLines({ name: "Line window", lines: 3 }, defaultLayers)).toBe(3)
        expect(resolvePresenterStyleLines({ name: "No slide", lines: 3, layers: ["background", "overlays"] }, defaultLayers)).toBe(0)
        expect(resolvePresenterStyleLines({ name: "Invalid", lines: Number.NaN }, defaultLayers)).toBe(0)
    })
})

describe("controller draw position", () => {
    const style = { width: 1920, height: 1080 }

    it("maps a touch in a matching window straight onto the slide", () => {
        expect(windowOffsetToSlide({ x: 0.25, y: 0.75 }, { width: 1920, height: 1080 }, style)).toEqual({ x: 480, y: 810 })
    })

    it("maps a touch in a portrait window onto the centered slide, not the letterbox bars", () => {
        // 1080x1920 window: the slide shows at 1080x607.5, starting 656.25px from the top
        const window = { width: 1080, height: 1920 }
        expect(getDrawSpace(window, style)).toEqual({ width: 1920, height: 1080 })
        expect(windowOffsetToSlide({ x: 0.5, y: 0.5 }, window, style)).toEqual({ x: 960, y: 540 })
        expect(windowOffsetToSlide({ x: 0, y: 656.25 / 1920 }, window, style)).toEqual({ x: 0, y: 0 })
        expect(windowOffsetToSlide({ x: 1, y: (656.25 + 607.5) / 1920 }, window, style)).toEqual({ x: 1920, y: 1080 })
    })

    it("clamps a touch on a letterbox bar to the slide edge", () => {
        expect(windowOffsetToSlide({ x: 0.5, y: 0 }, { width: 1080, height: 1920 }, style)).toEqual({ x: 960, y: 0 })
    })

    it("uses a 1920-wide space for a 4:3 style", () => {
        expect(getDrawSpace({ width: 1920, height: 1080 }, { width: 1440, height: 1080 })).toEqual({ width: 1920, height: 1440 })
        expect(windowOffsetToSlide({ x: 0.5, y: 1 }, { width: 1920, height: 1080 }, { width: 1440, height: 1080 })).toEqual({ x: 960, y: 1440 })
    })

    it("falls back to the plain fraction when the window size is unknown", () => {
        expect(windowOffsetToSlide({ x: 0.5, y: 0.5 }, { width: 0, height: 0 }, style)).toEqual({ x: 960, y: 540 })
    })
})
