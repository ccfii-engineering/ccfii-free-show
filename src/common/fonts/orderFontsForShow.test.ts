import { describe, expect, it } from "vitest"
import { addRecentFont, MAX_RECENT_FONTS, normalizeFontName, orderFontsForShow } from "./orderFontsForShow"

describe("normalizeFontName", () => {
    it("strips single and double quotes and whitespace", () => {
        expect(normalizeFontName("'CMGSans'")).toBe("CMGSans")
        expect(normalizeFontName(' "Times New Roman" ')).toBe("Times New Roman")
        expect(normalizeFontName("Arial")).toBe("Arial")
    })

    it("returns an empty string for empty input", () => {
        expect(normalizeFontName("")).toBe("")
        expect(normalizeFontName("''")).toBe("")
    })
})

describe("orderFontsForShow", () => {
    const systemFonts = ["Arial", "CMGSans", "Georgia", "Verdana"]

    it("puts used fonts first, then recent, then the rest", () => {
        expect(orderFontsForShow({ systemFonts, usedInShow: ["Georgia"], recent: ["Verdana", "Arial"] })).toEqual({
            used: ["Georgia"],
            recent: ["Verdana", "Arial"],
            all: ["CMGSans"]
        })
    })

    it("lists a font only once, in its highest group", () => {
        const result = orderFontsForShow({ systemFonts, usedInShow: ["Arial"], recent: ["Arial", "Georgia"] })
        expect(result.used).toEqual(["Arial"])
        expect(result.recent).toEqual(["Georgia"])
        expect(result.all).toEqual(["CMGSans", "Verdana"])
    })

    it("de-duplicates repeated entries and keeps first-seen order", () => {
        const result = orderFontsForShow({ systemFonts, usedInShow: ["Verdana", "Arial", "Verdana"], recent: ["Georgia", "Georgia"] })
        expect(result.used).toEqual(["Verdana", "Arial"])
        expect(result.recent).toEqual(["Georgia"])
    })

    it("matches quoted names against the unquoted system list", () => {
        const result = orderFontsForShow({ systemFonts, usedInShow: ["'CMGSans'"], recent: ['"Georgia"'] })
        expect(result.used).toEqual(["CMGSans"])
        expect(result.recent).toEqual(["Georgia"])
        expect(result.all).toEqual(["Arial", "Verdana"])
    })

    it("matches case-insensitively and returns the system spelling", () => {
        const result = orderFontsForShow({ systemFonts, usedInShow: ["arial"], recent: [] })
        expect(result.used).toEqual(["Arial"])
        expect(result.all).not.toContain("Arial")
    })

    it("keeps a used font that is not installed, but drops an uninstalled recent font", () => {
        const result = orderFontsForShow({ systemFonts, usedInShow: ["Custom Font"], recent: ["Gone Font", "Georgia"] })
        expect(result.used).toEqual(["Custom Font"])
        expect(result.recent).toEqual(["Georgia"])
    })

    it("handles empty inputs", () => {
        expect(orderFontsForShow({ systemFonts: [], usedInShow: [], recent: [] })).toEqual({ used: [], recent: [], all: [] })
        expect(orderFontsForShow({ systemFonts, usedInShow: [], recent: [] })).toEqual({ used: [], recent: [], all: systemFonts })
        expect(orderFontsForShow({ systemFonts, usedInShow: ["", "''"], recent: [""] }).all).toEqual(systemFonts)
    })

    it("tolerates missing lists", () => {
        expect(orderFontsForShow({ systemFonts } as any).all).toEqual(systemFonts)
    })
})

describe("addRecentFont", () => {
    it("puts the picked font first", () => {
        expect(addRecentFont(["Arial"], "Georgia")).toEqual(["Georgia", "Arial"])
    })

    it("moves an existing font to the front instead of duplicating it", () => {
        expect(addRecentFont(["Arial", "Georgia", "Verdana"], "'Verdana'")).toEqual(["Verdana", "Arial", "Georgia"])
    })

    it("caps the list", () => {
        let list: string[] = []
        for (let i = 0; i < MAX_RECENT_FONTS + 4; i++) list = addRecentFont(list, "Font " + i)
        expect(list).toHaveLength(MAX_RECENT_FONTS)
        expect(list[0]).toBe("Font " + (MAX_RECENT_FONTS + 3))
    })

    it("ignores an empty pick and a missing list", () => {
        expect(addRecentFont(["Arial"], "")).toEqual(["Arial"])
        expect(addRecentFont(undefined as any, "Arial")).toEqual(["Arial"])
    })
})
