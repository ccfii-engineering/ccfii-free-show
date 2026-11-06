import { describe, expect, it } from "vitest"
import type { Item } from "../../../../types/Show"
import { getOwnTextStyleSlideIds, getScopeDescriptionKey, getTypeOrdinal, hasOwnTextStyle, matchItemIndexes, resetTextStyleToTemplate } from "./textScope"

const text = (value: string, style = "", extra: Partial<Item> = {}): Item => ({ type: "text", style: "left:0px;", align: "", lines: [{ align: "", text: [{ value, style }] }], ...extra })
const media = (): Item => ({ type: "media", style: "" })

const TEMPLATE = [text("", "font-size: 80px;color: #ffffff;")]

describe("matchItemIndexes", () => {
    it("matches the same type at the same position among that type", () => {
        const slide = [text("a"), media(), text("b")]
        const other = [media(), text("x"), text("y")]
        expect(getTypeOrdinal(slide, 2)).toBe(1)
        expect(matchItemIndexes(slide, [2], other)).toEqual([{ source: 2, target: 2 }])
        expect(matchItemIndexes(slide, [0], other)).toEqual([{ source: 0, target: 1 }])
    })

    it("leaves out items with no match", () => {
        const slide = [text("a"), text("b")]
        expect(matchItemIndexes(slide, [0, 1], [text("x")])).toEqual([{ source: 0, target: 0 }])
        expect(matchItemIndexes(slide, [0], [media()])).toEqual([])
        expect(matchItemIndexes(slide, [5], [text("x")])).toEqual([])
    })

    it("treats an item without type as text", () => {
        const untyped: Item = { style: "", lines: [] }
        expect(matchItemIndexes([untyped], [0], [text("x")])).toEqual([{ source: 0, target: 0 }])
    })
})

describe("own text style", () => {
    it("is false when the slide has the template style", () => {
        expect(hasOwnTextStyle([text("one", "font-size: 80px;color: #ffffff;")], TEMPLATE)).toBe(false)
    })

    it("ignores declaration order", () => {
        expect(hasOwnTextStyle([text("one", "color: #ffffff;font-size: 80px;")], TEMPLATE)).toBe(false)
    })

    it("is true when a run style or alignment differs", () => {
        expect(hasOwnTextStyle([text("one", "font-size: 120px;color: #ffffff;")], TEMPLATE)).toBe(true)
        const aligned = text("one", "font-size: 80px;color: #ffffff;")
        aligned.lines![0].align = "text-align: left;"
        expect(hasOwnTextStyle([aligned], TEMPLATE)).toBe(true)
    })

    it("is false without a template or without text", () => {
        expect(hasOwnTextStyle([text("one", "font-size: 1px;")], [])).toBe(false)
        expect(hasOwnTextStyle([text("one", "font-size: 1px;")], undefined)).toBe(false)
        expect(hasOwnTextStyle([media()], TEMPLATE)).toBe(false)
    })

    it("lists the slides that differ", () => {
        const slides = [
            { id: "a", items: [text("one", "font-size: 80px;color: #ffffff;")] },
            { id: "b", items: [text("two", "font-size: 90px;color: #ffffff;")] },
            { id: "c", items: [text("three", "font-size: 80px;color: #ff0000;")] }
        ]
        expect(getOwnTextStyleSlideIds(slides, () => TEMPLATE)).toEqual(["b", "c"])
        expect(getOwnTextStyleSlideIds(slides, (id) => (id === "b" ? TEMPLATE : null))).toEqual(["b"])
    })
})

describe("resetTextStyleToTemplate", () => {
    it("restores the template style, keeps the text and does not change the input", () => {
        const items = [text("keep me", "font-size: 120px;color: #ff0000;")]
        const snapshot = JSON.stringify(items)
        const reset = resetTextStyleToTemplate(items, TEMPLATE)

        expect(reset[0].lines![0].text[0].value).toBe("keep me")
        expect(reset[0].lines![0].text[0].style).toBe("font-size: 80px;color: #ffffff;")
        expect(JSON.stringify(items)).toBe(snapshot)
        expect(hasOwnTextStyle(reset, TEMPLATE)).toBe(false)
    })

    it("keeps items that come from the template and non-text items", () => {
        const items = [{ ...text("deco", "font-size: 1px;"), fromTemplate: true }, media(), text("body", "font-size: 5px;")]
        const reset = resetTextStyleToTemplate(items, TEMPLATE)
        expect(reset[0].lines![0].text[0].style).toBe("font-size: 1px;")
        expect(reset[1]).toEqual(media())
        expect(reset[2].lines![0].text[0].style).toBe("font-size: 80px;color: #ffffff;")
    })
})

describe("getScopeDescriptionKey", () => {
    it("maps scopes to description keys", () => {
        expect(getScopeDescriptionKey("slide", false)).toBe("text_scope.desc_slide")
        expect(getScopeDescriptionKey("all", false)).toBe("text_scope.desc_all")
        expect(getScopeDescriptionKey("template", true)).toBe("text_scope.desc_template")
        expect(getScopeDescriptionKey("template", false)).toBe("text_scope.desc_no_template")
    })
})
