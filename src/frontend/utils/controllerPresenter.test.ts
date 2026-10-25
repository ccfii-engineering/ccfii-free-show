import { describe, expect, it } from "vitest"
import { resolvePresenterStyleLines } from "./controllerPresenter"

describe("controller preview output style projection", () => {
    const defaultLayers = ["background", "slide", "overlays"]

    it("provides the active output's line window and suppresses it when slide output is disabled", () => {
        expect(resolvePresenterStyleLines({ name: "Line window", lines: 3 }, defaultLayers)).toBe(3)
        expect(resolvePresenterStyleLines({ name: "No slide", lines: 3, layers: ["background", "overlays"] }, defaultLayers)).toBe(0)
        expect(resolvePresenterStyleLines({ name: "Invalid", lines: Number.NaN }, defaultLayers)).toBe(0)
    })
})
