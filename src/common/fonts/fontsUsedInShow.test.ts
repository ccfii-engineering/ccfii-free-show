import { describe, expect, it } from "vitest"
import type { Show } from "../../types/Show"
import { collectFontsUsedInShow } from "./fontsUsedInShow"

function showWith(slides: any): Show {
    return { name: "Test", category: null, settings: { activeLayout: "", template: null }, timestamps: { created: 0, modified: null, used: null }, meta: {}, slides, layouts: {}, media: {} } as unknown as Show
}

const textItem = (style: string, runs: string[] = []) => ({ style, lines: [{ align: "", text: runs.map((s) => ({ value: "x", style: s })) }] })

describe("collectFontsUsedInShow", () => {
    it("reads font-family from item styles", () => {
        const show = showWith({ a: { items: [textItem("top:0;font-family:Georgia;color:#fff;")] } })
        expect(collectFontsUsedInShow(show)).toEqual(["Georgia"])
    })

    it("reads font-family from text-run styles", () => {
        const show = showWith({ a: { items: [textItem("top:0;", ["font-family:Verdana;font-size:80px;"])] } })
        expect(collectFontsUsedInShow(show)).toEqual(["Verdana"])
    })

    it("strips quotes and keeps only the first family of a fallback list", () => {
        const show = showWith({ a: { items: [textItem("font-family: 'CMGSans', sans-serif;"), textItem('font-family:"Times New Roman";')] } })
        expect(collectFontsUsedInShow(show)).toEqual(["CMGSans", "Times New Roman"])
    })

    it("de-duplicates across slides, items and runs in first-seen order", () => {
        const show = showWith({
            a: { items: [textItem("font-family:'Arial';", ["font-family:Georgia;"])] },
            b: { items: [textItem("font-family:Georgia;", ["font-family:'Arial';", "font-family:Tahoma;"])] }
        })
        expect(collectFontsUsedInShow(show)).toEqual(["Arial", "Georgia", "Tahoma"])
    })

    it("ignores styles without a font-family, such as shorthand-free sizes", () => {
        const show = showWith({ a: { items: [textItem("font-size:50px;color:red;", ["font-weight:bold;"])] } })
        expect(collectFontsUsedInShow(show)).toEqual([])
    })

    it("does not confuse similar properties", () => {
        const show = showWith({ a: { items: [textItem("x-font-family:Nope;font-family-fallback:Nope;")] } })
        expect(collectFontsUsedInShow(show)).toEqual([])
    })

    it("handles empty and missing data", () => {
        expect(collectFontsUsedInShow(undefined)).toEqual([])
        expect(collectFontsUsedInShow(showWith({}))).toEqual([])
        expect(collectFontsUsedInShow(showWith({ a: {}, b: { items: [{ style: "" }, { lines: [{ text: [] }] } as any, { style: undefined } as any] } }))).toEqual([])
    })
})
