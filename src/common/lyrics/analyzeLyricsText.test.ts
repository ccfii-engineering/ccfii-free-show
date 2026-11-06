import { describe, expect, it } from "vitest"
import { analyzeLyricsText, DEFAULT_MAX_LINE_LENGTH } from "./analyzeLyricsText"

describe("analyzeLyricsText slides and groups", () => {
    it("returns nothing for empty or whitespace-only text", () => {
        expect(analyzeLyricsText("").slideCount).toBe(0)
        expect(analyzeLyricsText("  \n\n ").slideCount).toBe(0)
        expect(analyzeLyricsText("").groups).toEqual([])
    })

    it("treats a blank line as a slide break", () => {
        const result = analyzeLyricsText("[Verse 1]\nline a\nline b\n\nline c\n\n[Chorus]\nline d")
        expect(result.slideCount).toBe(3)
        expect(result.slides.map((slide) => slide.group)).toEqual(["Verse 1", null, "Chorus"])
    })

    it("groups slides under the latest [Group] line", () => {
        const result = analyzeLyricsText("[Verse 1]\na\n\nb\n\n[Chorus]\nc")
        expect(result.groups).toEqual([
            { name: "Verse 1", slideCount: 2, firstSlide: 1 },
            { name: "Chorus", slideCount: 1, firstSlide: 3 }
        ])
    })

    it("names a leading slide without a group Verse, like the editor does", () => {
        const result = analyzeLyricsText("a\n\nb")
        expect(result.slideCount).toBe(2)
        expect(result.groups).toEqual([{ name: "Verse", slideCount: 2, firstSlide: 1 }])
    })

    it("does not read a first line with text after the bracket as a group", () => {
        const result = analyzeLyricsText("[Verse 1]\na\n\n[Chorus] la\nb")
        expect(result.slides[1].group).toBeNull()
        expect(result.groups).toEqual([{ name: "Verse 1", slideCount: 2, firstSlide: 1 }])
    })

    it("keeps a group-only slide as a slide", () => {
        const result = analyzeLyricsText("[Intro]\n\n[Verse 1]\nhello")
        expect(result.slideCount).toBe(2)
        expect(result.slides[0].lines).toEqual([])
    })

    it("returns the lines of each slide without the group line", () => {
        const result = analyzeLyricsText("[Verse 1]\nline a\nline b")
        expect(result.slides[0].lines).toEqual(["line a", "line b"])
    })
})

describe("analyzeLyricsText textbox markers and chords", () => {
    it("does not count a textbox marker as a line or as a group", () => {
        const result = analyzeLyricsText("[#1]\nfirst\n[#2:es]\nsegundo")
        expect(result.slideCount).toBe(1)
        expect(result.slides[0].group).toBeNull()
        expect(result.groups[0].name).toBe("Verse")
        expect(result.slides[0].textboxes).toEqual([
            { index: 1, language: "", lines: ["first"] },
            { index: 2, language: "es", lines: ["segundo"] }
        ])
    })

    it("keeps content that follows a marker on the same line", () => {
        const result = analyzeLyricsText("[#1] hello there")
        expect(result.slides[0].textboxes[0].lines).toEqual(["hello there"])
    })

    it("ignores textbox markers for line length", () => {
        const limit = 10
        const result = analyzeLyricsText("[#1:en] 0123456789", { maxLineLength: limit })
        expect(result.longLines).toEqual([])
    })

    it("strips chords from the lines and from the length", () => {
        const result = analyzeLyricsText("[Verse 1]\n[C]Amazing [G]grace", { maxLineLength: 13 })
        expect(result.slides[0].lines).toEqual(["Amazing grace"])
        expect(result.longLines).toEqual([])
    })

    it("keeps long bracketed text that is probably not a chord", () => {
        const result = analyzeLyricsText("[Verse 1]\nhi [not a chord at all] there")
        expect(result.slides[0].lines[0]).toBe("hi [not a chord at all] there")
    })

    it("keeps the virtual break marker in the text", () => {
        const result = analyzeLyricsText("[Verse 1]\nfirst half[_VB]second half")
        expect(result.slides[0].lines[0]).toBe("first half[_VB]second half")
    })
})

describe("analyzeLyricsText long lines", () => {
    it("uses a default limit and exposes it", () => {
        expect(DEFAULT_MAX_LINE_LENGTH).toBeGreaterThan(20)
        const ok = "a".repeat(DEFAULT_MAX_LINE_LENGTH)
        const long = "a".repeat(DEFAULT_MAX_LINE_LENGTH + 1)
        expect(analyzeLyricsText(`[Verse 1]\n${ok}`).longLines).toEqual([])
        expect(analyzeLyricsText(`[Verse 1]\n${long}`).longLines).toHaveLength(1)
    })

    it("reports slide number, line number, length and text", () => {
        const result = analyzeLyricsText("[Verse 1]\nshort\n\nthis line is far too long\nok", { maxLineLength: 10 })
        expect(result.longLines).toEqual([{ slide: 2, line: 1, length: 25, text: "this line is far too long" }])
    })

    it("treats the limit as an option and ignores invalid values", () => {
        expect(analyzeLyricsText("abcdef", { maxLineLength: 5 }).longLines).toHaveLength(1)
        expect(analyzeLyricsText("abcdef", { maxLineLength: 6 }).longLines).toHaveLength(0)
        expect(analyzeLyricsText("a".repeat(DEFAULT_MAX_LINE_LENGTH + 1), { maxLineLength: 0 }).longLines).toHaveLength(1)
    })
})
