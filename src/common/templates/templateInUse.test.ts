import { describe, expect, it } from "vitest"
import { describeTemplateClickTarget, getTemplateApplyBlock, resolveTemplateInUse } from "./templateInUse"

// Precedence mirrors the app today:
// - slide template (slide.settings.template), group template, first slide template (from the show-level template's settings)
//   are decided in historyActions.ts TEMPLATE `updateSlidesWithTemplate`
// - category template overrides the show template in Slides.svelte `updateTemplate`
// - EditHeader.svelte reads slide > group > show

describe("resolveTemplateInUse", () => {
    it("uses the show template for the whole show", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1" })).toEqual({ templateId: "show1", source: "show", outputStyleOverride: null })
    })

    it("returns nothing when no template is set", () => {
        expect(resolveTemplateInUse({})).toEqual({ templateId: null, source: null, outputStyleOverride: null })
        expect(resolveTemplateInUse({ showTemplateId: "", categoryTemplateId: "", slide: { slideTemplateId: "" } })).toEqual({ templateId: null, source: null, outputStyleOverride: null })
    })

    it("category template wins over the show template", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", categoryTemplateId: "cat1" })).toMatchObject({ templateId: "cat1", source: "category" })
    })

    it("ignores a category template that no longer exists", () => {
        const isKnownTemplate = (id: string) => id !== "gone"
        expect(resolveTemplateInUse({ showTemplateId: "show1", categoryTemplateId: "gone", isKnownTemplate })).toMatchObject({ templateId: "show1", source: "show" })
    })

    it("first slide template beats the category and show template on the first slide", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", categoryTemplateId: "cat1", firstSlideTemplateId: "first1", slide: { isFirstSlide: true } })).toMatchObject({ templateId: "first1", source: "first-slide" })
    })

    it("first slide template does not apply to other slides", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", firstSlideTemplateId: "first1", slide: { isFirstSlide: false } })).toMatchObject({ templateId: "show1", source: "show" })
    })

    it("group template beats the first slide template", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", firstSlideTemplateId: "first1", slide: { isFirstSlide: true, groupTemplateId: "group1" } })).toMatchObject({ templateId: "group1", source: "group" })
    })

    it("slide template beats the group template", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", slide: { slideTemplateId: "slide1", groupTemplateId: "group1" } })).toMatchObject({ templateId: "slide1", source: "slide" })
    })

    it("a slide template equal to the first slide template on the first slide counts as first-slide", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", firstSlideTemplateId: "first1", slide: { isFirstSlide: true, slideTemplateId: "first1", groupTemplateId: "group1" } })).toMatchObject({ templateId: "first1", source: "first-slide" })
    })

    it("a slide template equal to the first slide template elsewhere is a slide template", () => {
        expect(resolveTemplateInUse({ firstSlideTemplateId: "first1", slide: { isFirstSlide: false, slideTemplateId: "first1" } })).toMatchObject({ templateId: "first1", source: "slide" })
    })

    it("falls back to the show-level template for a slide without its own", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", categoryTemplateId: "cat1", slide: {} })).toMatchObject({ templateId: "cat1", source: "category" })
    })

    it("reports the output style template separately without changing the source", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", outputStyleTemplateId: "style1" })).toEqual({ templateId: "show1", source: "show", outputStyleOverride: "style1" })
        expect(resolveTemplateInUse({ outputStyleTemplateId: "style1" })).toEqual({ templateId: null, source: null, outputStyleOverride: "style1" })
    })

    it("treats an empty output style template as no override", () => {
        expect(resolveTemplateInUse({ showTemplateId: "show1", outputStyleTemplateId: "" }).outputStyleOverride).toBeNull()
    })
})

describe("describeTemplateClickTarget", () => {
    it("targets the whole show when nothing is selected", () => {
        expect(describeTemplateClickTarget({ selectedSlideCount: 0, totalSlideCount: 8 })).toMatchObject({ scope: "show", count: 8 })
    })

    it("targets the selected slides when some are selected", () => {
        const target = describeTemplateClickTarget({ selectedSlideCount: 3, totalSlideCount: 8 })
        expect(target).toMatchObject({ scope: "slides", count: 3 })
        expect(target.label).toContain("3")
    })

    it("counts all slides selected as a whole-show apply", () => {
        expect(describeTemplateClickTarget({ selectedSlideCount: 8, totalSlideCount: 8 })).toMatchObject({ scope: "show", count: 8 })
    })

    it("handles an empty show", () => {
        expect(describeTemplateClickTarget({ selectedSlideCount: 0, totalSlideCount: 0 })).toMatchObject({ scope: "show", count: 0 })
    })

    it("uses singular and plural labels", () => {
        expect(describeTemplateClickTarget({ selectedSlideCount: 1, totalSlideCount: 4 }).label).not.toBe(describeTemplateClickTarget({ selectedSlideCount: 2, totalSlideCount: 4 }).label)
    })
})

describe("getTemplateApplyBlock", () => {
    it("is not blocked by default", () => {
        expect(getTemplateApplyBlock({ scope: "show" })).toBeNull()
        expect(getTemplateApplyBlock({ scope: "slides" })).toBeNull()
    })

    it("blocks a locked show", () => {
        expect(getTemplateApplyBlock({ scope: "show", showLocked: true })).toBe("show_locked")
        expect(getTemplateApplyBlock({ scope: "slides", showLocked: true })).toBe("show_locked")
    })

    it("blocks a read-only profile", () => {
        expect(getTemplateApplyBlock({ scope: "show", readOnly: true })).toBe("read_only")
        expect(getTemplateApplyBlock({ scope: "slides", readOnly: true })).toBe("read_only")
    })

    it("blocks a whole-show apply when the category has a template", () => {
        expect(getTemplateApplyBlock({ scope: "show", categoryTemplateId: "cat1" })).toBe("category_template")
    })

    it("does not apply the category block to selected slides", () => {
        expect(getTemplateApplyBlock({ scope: "slides", categoryTemplateId: "cat1" })).toBeNull()
    })

    it("checks lock first, then read-only, then category", () => {
        expect(getTemplateApplyBlock({ scope: "show", showLocked: true, readOnly: true, categoryTemplateId: "cat1" })).toBe("show_locked")
        expect(getTemplateApplyBlock({ scope: "show", readOnly: true, categoryTemplateId: "cat1" })).toBe("read_only")
    })
})
