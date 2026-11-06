import { describe, expect, it } from "vitest"
import type { Item } from "../../../../types/Show"
import { getLayersFrontToBack } from "./layers"

const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, style: "", ...extra })

describe("getLayersFrontToBack", () => {
    it("puts the last stored item first and keeps stored indexes", () => {
        const layers = getLayersFrontToBack([item("back"), item("mid"), item("front")])
        expect(layers.map((a) => a.item.id)).toEqual(["front", "mid", "back"])
        expect(layers.map((a) => a.index)).toEqual([2, 1, 0])
    })

    it("marks only items flagged fromTemplate", () => {
        const layers = getLayersFrontToBack([item("a", { fromTemplate: true }), item("b")])
        expect(layers.map((a) => a.fromTemplate)).toEqual([false, true])
    })

    it("does not mutate the input and tolerates missing lists", () => {
        const items = [item("a"), item("b")]
        getLayersFrontToBack(items)
        expect(items.map((a) => a.id)).toEqual(["a", "b"])
        expect(getLayersFrontToBack(undefined)).toEqual([])
        expect(getLayersFrontToBack(null)).toEqual([])
    })
})
