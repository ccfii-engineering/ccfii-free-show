import { describe, expect, it, vi } from "vitest"

vi.mock("../../audio/audioPlayer", () => ({ AudioPlayer: { getAllPlaying: vi.fn(() => []) } }))
vi.mock("../../IPC/main", () => ({ sendMain: vi.fn(), requestMain: vi.fn() }))
vi.mock("../../utils/shortcuts", () => ({ playFolder: vi.fn(), togglePlayingMedia: vi.fn() }))
vi.mock("../../utils/language", () => ({ translateText: (key: string) => key }))

vi.mock("../../utils/popup", () => ({ confirmCustom: vi.fn() }))
vi.mock("../actions/actions", () => ({ customActionActivation: vi.fn(), runAction: vi.fn() }))
vi.mock("../../utils/startup", () => ({ startup: vi.fn(), contentProviderSync: vi.fn() }))
vi.mock("../../audio/audioProcessor", () => ({}))
vi.mock("../../audio/audioAnalyser", () => ({ AudioAnalyser: {} }))
vi.mock("../../audio/audioFading", () => ({ fadeinAllPlayingAudio: vi.fn(), fadeoutAllPlayingAudio: vi.fn() }))
vi.mock("../../utils/controllerTalk", () => ({ publishPresenterSnapshot: vi.fn() }))
vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn(), GlobalWorkerOptions: {} }))
vi.mock("../output/clear", () => ({ clearBackground: vi.fn(), clearSlide: vi.fn() }))
vi.mock("./showActions", () => ({ getFewestOutputLines: vi.fn(), getItemWithMostLines: vi.fn(), replaceDynamicValues: vi.fn() }))

import type { Item, Layout, LayoutRef, Media, Slide, Template } from "../../../types/Show"
import { getItemsCountByType, getTemplateText, isEmptyOrSpecial, mergeWithTemplate, sortItemsByType, updateLayoutsFromTemplate, updateSlideFromTemplate } from "./output"

function textItem(value: string, style = "", itemStyle = "", extra: Partial<Item> = {}): Item {
    return { style: itemStyle, align: "", lines: [{ align: "", text: [{ value, style }] }], ...extra } as Item
}

function getText(item: Item) {
    return (item.lines || []).map((l) => l.text.map((t) => t.value).join("")).join("")
}

describe("mergeWithTemplate", () => {
    it("returns cloned slide items unchanged when the template has no items", () => {
        const slide = [textItem("Hello", "color: red;")]
        const result = mergeWithTemplate(slide, [])
        expect(result).toEqual(slide)
        expect(result).not.toBe(slide)
        expect(result[0]).not.toBe(slide[0])
    })

    it("applies template item style, align and text style to slide items", () => {
        const slide = [textItem("Hello", "color: red;", "left: 1px;")]
        const template = [{ ...textItem("", "font-size: 80px;", "top: 5px;"), align: "align-items: center;", lines: [{ align: "text-align: right;", text: [{ value: "", style: "font-size: 80px;" }] }] } as Item]
        const [item] = mergeWithTemplate(slide, template)
        expect(item.style).toBe("top: 5px;")
        expect(item.align).toBe("align-items: center;")
        expect(item.lines![0].align).toBe("text-align: right;")
        expect(item.lines![0].text[0]).toEqual({ value: "Hello", style: "font-size: 80px;" })
    })

    it("drops previously template-sourced items from the slide", () => {
        const slide = [textItem("A"), textItem("From template", "", "", { fromTemplate: true } as any)]
        const result = mergeWithTemplate(slide, [textItem("", "font-size: 10px;")])
        expect(result).toHaveLength(1)
        expect(getText(result[0])).toBe("A")
    })

    it("limits template textboxes to the number of slide textboxes, and adds the rest only on overflow", () => {
        const slide = [textItem("A")]
        const template = [textItem("", "font-size: 1px;"), textItem("", "font-size: 2px;")]
        expect(mergeWithTemplate(slide, template)).toHaveLength(1)
        expect(mergeWithTemplate(slide, template, false, true, true)).toHaveLength(1)
        const overflow = mergeWithTemplate(slide, template, true)
        expect(overflow).toHaveLength(2)
        expect(getText(overflow[1])).toBe("")
        expect(overflow[1].lines![0].text[0].style).toBe("font-size: 2px;")
    })

    it("removes empty slide text items on overflow when the template has fewer items", () => {
        const result = mergeWithTemplate([textItem("A"), textItem("")], [textItem("", "font-size: 1px;")], true)
        expect(result).toHaveLength(1)
        expect(getText(result[0])).toBe("A")
    })

    it("resolves auto and textFit from the template", () => {
        const slide = () => [textItem("A", "", "", { auto: true, autoFontSize: 40 } as any)]
        let [item] = mergeWithTemplate(slide(), [textItem("", "", "", { auto: false } as any)])
        expect(item.auto).toBe(false)
        expect((item as any).autoFontSize).toBeUndefined()
        ;[item] = mergeWithTemplate(slide(), [textItem("", "", "", { textFit: "growToFit" } as any)])
        expect(item.auto).toBe(true)
        expect((item as any).textFit).toBe("growToFit")
        ;[item] = mergeWithTemplate(slide(), [textItem("")])
        expect(item.auto).toBe(false)
        expect((item as any).textFit).toBeUndefined()
        ;[item] = mergeWithTemplate(slide(), [textItem("", "", "", { auto: true } as any)], false, false)
        expect((item as any).autoFontSize).toBe(40)
    })

    it("keeps the original text color when a slide item has mixed colors and the template is not clicked", () => {
        const item = { style: "", align: "", lines: [{ align: "", text: [{ value: "a", style: "color: red;" }, { value: "b", style: "color: blue;" }] }] } as Item
        const template = [textItem("", "color: white;font-size: 50px;")]
        const [merged] = mergeWithTemplate([item], template)
        expect(merged.lines![0].text.map((a) => a.style)).toEqual(["color: white;font-size: 50px;color: red;", "color: white;font-size: 50px;color: blue;"])
        const [clicked] = mergeWithTemplate([item], template, false, true, true)
        expect(clicked.lines![0].text.map((a) => a.style)).toEqual(["color: white;font-size: 50px;", "color: white;font-size: 50px;"])
    })

    it("preserves per-text bold, italic and decoration when formats are mixed", () => {
        const item = { style: "", align: "", lines: [{ align: "", text: [{ value: "a", style: "font-weight: bold;font-style: italic;text-decoration: underline;" }, { value: "b", style: "" }] }] } as Item
        const [merged] = mergeWithTemplate([item], [textItem("", "text-decoration: line-through;")])
        expect(merged.lines![0].text[0].style).toBe("text-decoration: line-through;font-weight: bold;font-style: italic;text-decoration: line-through underline;")
        expect(merged.lines![0].text[1].style).toBe("text-decoration: line-through;font-weight: normal;font-style: normal;text-decoration: line-through;")
    })

    it("adds bullets from the template and strips them on overflow merges when the template has none", () => {
        const [bulleted] = mergeWithTemplate([textItem("Point")], [textItem("• ", "")])
        expect(getText(bulleted)).toBe("• Point")
        const [stripped] = mergeWithTemplate([textItem("• Point")], [textItem("", "")], true)
        expect(getText(stripped)).toBe("Point")
    })

    it("fills empty text from dynamic template values and leaves disableTemplate text unstyled", () => {
        const [item] = mergeWithTemplate([textItem("")], [textItem("{show_name}", "font-size: 9px;")])
        expect(getText(item)).toBe("{show_name}")
        const custom = { style: "", align: "", lines: [{ align: "", text: [{ value: "x", style: "color: green;", customType: "disableTemplate" }] }] } as Item
        const [kept] = mergeWithTemplate([custom], [textItem("", "font-size: 9px;")])
        expect(kept.lines![0].text[0].style).toBe("color: green;")
    })

    it("in item mode only copies item style and align", () => {
        const [item] = mergeWithTemplate([textItem("Hello", "color: red;", "left: 1px;")], [textItem("", "font-size: 80px;", "top: 5px;")], false, true, false, "item")
        expect(item.style).toBe("top: 5px;")
        expect(item.lines![0].text[0].style).toBe("color: red;")
    })

    it("uses the template media source and resets extra keys", () => {
        const slide = [{ type: "media", style: "", src: "old.png", filter: "x", flipped: true } as any]
        const template = [{ type: "media", style: "w: 1;", src: "new.png", filter: "blur(2px)" } as Item]
        const [item] = mergeWithTemplate(slide, template)
        expect(item.src).toBe("new.png")
        expect((item as any).filter).toBe("blur(2px)")
        expect((item as any).flipped).toBeUndefined()
    })

    it("carries lineReveal from the slide item unless overflow is added", () => {
        const slide = () => [textItem("A", "", "", { lineReveal: true } as any)]
        expect((mergeWithTemplate(slide(), [textItem("")])[0] as any).lineReveal).toBe(true)
        expect((mergeWithTemplate(slide(), [textItem("")], true)[0] as any).lineReveal).toBeUndefined()
    })

    it("adds non-text template items not on the slide, marked fromTemplate", () => {
        const shape = { type: "shape", style: "w: 1;" } as Item
        expect(mergeWithTemplate([], [shape])).toEqual([{ ...shape, fromTemplate: true }])
    })

    it("does not add a template item that already exists on the slide", () => {
        const shape = { type: "shape", style: "w: 1;" } as Item
        const result = mergeWithTemplate([{ ...shape }], [shape])
        expect(result).toHaveLength(1)
        expect((result[0] as any).fromTemplate).toBeUndefined()
    })

    it("replaces scripture dynamic values and builds verse number texts", () => {
        const template = [textItem("{scripture_text}", "font-size: 40px;"), textItem("{scripture_reference}", "font-size: 20px;")]
        const result = mergeWithTemplate([], template, true, true, false, "", { scripture_reference: "John 3:16", scripture_text: [["16", "For God so loved"]] })
        expect(result.map(getText)).toContain("John 3:16")
        const verse = result.find((a) => getText(a).includes("For God"))!
        const parts = verse.lines![0].text
        expect(parts[0]).toMatchObject({ value: "16", customType: "disableTemplate" })
        expect(parts[0].style).toContain("color: #919191;")
        expect(parts[0].style).toContain("font-size: 60px;")
        expect(parts[1]).toMatchObject({ value: "For God so loved", sourceDynamicKey: "scripture_text:0" })
    })

    it("marks scripture decoration items as non-editable", () => {
        const template = [textItem("{scripture_text}"), textItem("{scripture_reference}")]
        const result = mergeWithTemplate([textItem("x")], template, true, true, false, "", { scripture_reference: "Ref", scripture_text: [["0", "Body"]] })
        expect(result.some((a) => (a as any).decoration)).toBe(true)
    })
})

describe("template item helpers", () => {
    it("sorts by type with text as default and skips empty entries", () => {
        const sorted = sortItemsByType([textItem("a"), { type: "media" } as Item, null as any, { type: "text" } as Item])
        expect(Object.keys(sorted).sort()).toEqual(["media", "text"])
        expect(sorted.text).toHaveLength(2)
        expect(getItemsCountByType([textItem("a"), { type: "media" } as Item, { type: "media" } as Item])).toEqual({ text: 1, media: 2 })
    })

    it("treats text with braces as template text and empty text as special", () => {
        expect(getTemplateText("{x}")).toBe("{x}")
        expect(getTemplateText("plain")).toBe("")
        expect(isEmptyOrSpecial(textItem(""))).toBe(true)
        expect(isEmptyOrSpecial(textItem("{x}"))).toBe(true)
        expect(isEmptyOrSpecial(textItem("plain"))).toBe(false)
    })
})

describe("updateSlideFromTemplate", () => {
    const slide = (): Slide => ({ group: "", color: null, settings: {}, notes: "", items: [textItem("a")] }) as Slide
    const tpl = (settings: any) => ({ name: "", color: null, category: null, items: [], settings }) as Template

    it("sets background color and first-slide template", () => {
        const template = tpl({ backgroundColor: "#111", firstSlideTemplate: "first" })
        expect(updateSlideFromTemplate(slide(), template, true).settings).toEqual({ color: "#111", template: "first" })
        expect(updateSlideFromTemplate(slide(), template, false).settings).toEqual({ color: "#111" })
        expect(updateSlideFromTemplate(slide(), template, true, false, "override").settings!.template).toBe("override")
    })

    it("clears the slide color when the template has none but the slide does", () => {
        const s = slide()
        s.settings = { color: "#222" }
        expect(updateSlideFromTemplate(s, tpl({})).settings!.color).toBe("")
    })
})

describe("updateLayoutsFromTemplate", () => {
    const tpl = (settings: any = {}) => ({ name: "", color: null, category: null, items: [], settings }) as Template
    const layouts = (): { [key: string]: Layout } => ({ l: { name: "", notes: "", slides: [{ id: "s1", background: "bgOld" }, { id: "s2" }] } as any })
    const ref = (index: number, type = "parent"): LayoutRef => ({ type, index, id: "s" + (index + 1) }) as any

    it("leaves layouts untouched for global mode without overflow removal, non-parent refs and missing slides", () => {
        const l = layouts()
        expect(updateLayoutsFromTemplate(l, {}, tpl({ backgroundPath: "/a.png" }), tpl(), "l", ref(0), "global").layouts.l.slides[0].background).toBe("bgOld")
        expect(updateLayoutsFromTemplate(l, {}, tpl({ backgroundPath: "/a.png" }), tpl(), "l", ref(0, "child"), "slide").layouts.l.slides[0].background).toBe("bgOld")
        expect(updateLayoutsFromTemplate(l, {}, tpl({ backgroundPath: "/a.png" }), tpl(), "l", ref(9), "slide").layouts.l.slides[0].background).toBe("bgOld")
    })

    it("adds a new media entry for the background path, or reuses an existing one", () => {
        const added = updateLayoutsFromTemplate(layouts(), {}, tpl({ backgroundPath: "/dir/bg.png" }), tpl(), "l", ref(0), "slide")
        const id = added.layouts.l.slides[0].background!
        expect(added.media[id]).toEqual({ path: "/dir/bg.png", name: "bg" })

        const media: { [key: string]: Media } = { existing: { path: "/dir/bg.png", name: "bg" } as Media }
        const reused = updateLayoutsFromTemplate(layouts(), media, tpl({ backgroundPath: "/dir/bg.png" }), tpl(), "l", ref(0), "slide")
        expect(reused.layouts.l.slides[0].background).toBe("existing")
        expect(Object.keys(reused.media)).toEqual(["existing"])
    })

    it("removes a background that came from the previous template", () => {
        const media: { [key: string]: Media } = { bgOld: { path: "/old.png", name: "old" } as Media }
        const result = updateLayoutsFromTemplate(layouts(), media, tpl(), tpl({ backgroundPath: "/old.png" }), "l", ref(0), "slide")
        expect(result.layouts.l.slides[0].background).toBe("")
    })

    it("merges template actions, replacing existing ones by id or first trigger", () => {
        const l = layouts()
        l.l.slides[0].actions = { slideActions: [{ id: "a1", triggers: ["x"] }, { id: "keep", triggers: ["k"] }] } as any
        const result = updateLayoutsFromTemplate(l, {}, tpl({ actions: [{ id: "a1", triggers: ["new"] }] }), tpl(), "l", ref(0), "slide")
        expect(result.layouts.l.slides[0].actions!.slideActions!.map((a: any) => a.id)).toEqual(["keep", "a1"])
    })

    it("tolerates non-object layouts and media", () => {
        expect(updateLayoutsFromTemplate(undefined as any, "x" as any, tpl(), tpl(), "l", ref(0), "slide")).toEqual({ layouts: {}, media: {} })
    })
})
