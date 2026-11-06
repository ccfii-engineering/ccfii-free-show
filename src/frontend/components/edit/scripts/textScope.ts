// Text style scope helpers for the Edit tools Text tab. Pure data in, data out: no store access.
//
// "This slide" keeps today's behaviour. "All slides" and "Template" need to know which item on
// another slide (or in a template) matches the item being edited, and which slides have text
// styling of their own compared to their template.

import type { Item } from "../../../../types/Show"
import { mergeWithTemplate } from "../../helpers/slideTemplateMerge"
import { getStyles } from "../../helpers/style"

export type TextScope = "slide" | "all" | "template"

export const TEXT_SCOPES: TextScope[] = ["slide", "all", "template"]

const typeOf = (item: Item | undefined | null) => item?.type || "text"

/** Position of an item among the items of its own type (0 for the first textbox, 1 for the second, ...). */
export function getTypeOrdinal(items: Item[], index: number): number {
    const type = typeOf(items[index])
    let ordinal = 0
    for (let i = 0; i < index; i++) if (typeOf(items[i]) === type) ordinal++
    return ordinal
}

/** The nth item of a type, as an index into `items`. -1 if there is none. */
function findByTypeOrdinal(items: Item[], type: string, ordinal: number): number {
    let seen = 0
    for (let i = 0; i < items.length; i++) {
        if (typeOf(items[i]) !== type) continue
        if (seen === ordinal) return i
        seen++
    }
    return -1
}

/**
 * Map the edited items to the matching items of another slide or a template: the same type at the same
 * position among that type (templates fill slide items the same way). Items without a match are left out.
 * The result is aligned with `sourceIndexes`, so entries with no match are dropped from both sides together.
 */
export function matchItemIndexes(sourceItems: Item[], sourceIndexes: number[], targetItems: Item[]): { source: number; target: number }[] {
    const pairs: { source: number; target: number }[] = []
    sourceIndexes.forEach((source) => {
        if (!sourceItems[source]) return
        const target = findByTypeOrdinal(targetItems || [], typeOf(sourceItems[source]), getTypeOrdinal(sourceItems, source))
        if (target >= 0) pairs.push({ source, target })
    })
    return pairs
}

function normalizeStyle(style: string | undefined) {
    return JSON.stringify(Object.entries(getStyles(style)).sort(([a], [b]) => a.localeCompare(b)))
}

/** Text styling that the Text tab edits: run styles and alignment. Position and size of the box belong to the Item tab. */
function textSignature(item: Item) {
    return {
        align: item.align || "",
        lines: (item.lines || []).map((line) => ({ align: line.align || "", text: (line.text || []).map((text) => normalizeStyle(text.style)) }))
    }
}

/**
 * Re-style the text items of a slide as its template would. Other properties (text content, position,
 * items that come from the template) are kept. Returns a new array, the input is not changed.
 */
export function resetTextStyleToTemplate(slideItems: Item[], templateItems: Item[]): Item[] {
    const items: Item[] = JSON.parse(JSON.stringify(slideItems || []))
    if (!templateItems?.length) return items

    const own = items.filter((a) => a && !a.fromTemplate)
    const merged = mergeWithTemplate(own, templateItems, false, true, false, "", {}).filter((a) => !a.fromTemplate)
    if (merged.length !== own.length) return items

    let next = 0
    items.forEach((item) => {
        if (!item || item.fromTemplate) return
        const source = merged[next++]
        if (!source || typeOf(item) !== "text" || !item.lines) return

        item.align = source.align || ""
        item.lines.forEach((line, i) => {
            const mergedLine = source.lines?.[i]
            if (!mergedLine) return
            line.align = mergedLine.align || ""
            line.text?.forEach((text, j) => {
                if (text.customType?.includes("disableTemplate")) return
                if (mergedLine.text?.[j]) text.style = mergedLine.text[j].style
            })
        })
    })

    return items
}

/** True if the slide's text styling differs from what its template gives it. */
export function hasOwnTextStyle(slideItems: Item[], templateItems: Item[] | undefined | null): boolean {
    if (!templateItems?.length || !slideItems?.length) return false

    const reset = resetTextStyleToTemplate(slideItems, templateItems)
    return slideItems.some((item, i) => {
        if (!item || item.fromTemplate || typeOf(item) !== "text" || !item.lines) return false
        return JSON.stringify(textSignature(item)) !== JSON.stringify(textSignature(reset[i]))
    })
}

export interface ScopeSlide {
    id: string
    items: Item[]
}

/** Ids of the slides whose text style differs from their template. `getTemplateItems` returns the items of the template that applies to a slide. */
export function getOwnTextStyleSlideIds(slides: ScopeSlide[], getTemplateItems: (slideId: string) => Item[] | undefined | null): string[] {
    const ids: string[] = []
    slides.forEach((slide) => {
        if (hasOwnTextStyle(slide.items, getTemplateItems(slide.id))) ids.push(slide.id)
    })
    return ids
}

/** Translation key for the one-line description of a scope. */
export function getScopeDescriptionKey(scope: TextScope, hasTemplate: boolean): string {
    if (scope === "all") return "text_scope.desc_all"
    if (scope === "template") return hasTemplate ? "text_scope.desc_template" : "text_scope.desc_no_template"
    return "text_scope.desc_slide"
}
