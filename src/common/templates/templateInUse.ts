// Pure template-in-use logic shared by the desktop frontend and the Remote app.
// No store access and no imports from src/frontend.
//
// Precedence matches the app today:
// - slide template > group template > first slide template: `updateSlidesWithTemplate` in historyActions.ts
// - category template overrides the show template: `updateTemplate` in Slides.svelte
// - the output style template is only an on-screen override (see `allOutputsHasStyleTemplate`)

export type TemplateSource = "slide" | "group" | "first-slide" | "category" | "show"
export type ApplyScope = "show" | "slides"
export type ApplyBlock = null | "show_locked" | "read_only" | "category_template"

export interface TemplateInUse {
    templateId: string | null
    source: TemplateSource | null
    /** Output style template that overrides what is shown on screen, if any. */
    outputStyleOverride: string | null
}

export interface ResolveTemplateInput {
    showTemplateId?: string | null
    categoryTemplateId?: string | null
    /** `settings.firstSlideTemplate` of the show-level template. */
    firstSlideTemplateId?: string | null
    outputStyleTemplateId?: string | null
    /** Leave out to resolve for the whole show. */
    slide?: {
        isFirstSlide?: boolean
        slideTemplateId?: string | null
        groupTemplateId?: string | null
    }
    /** Lets the caller drop ids of templates that no longer exist. Defaults to accepting every id. */
    isKnownTemplate?: (id: string) => boolean
}

export function resolveTemplateInUse(input: ResolveTemplateInput): TemplateInUse {
    const known = input.isKnownTemplate || (() => true)
    const outputStyleOverride = input.outputStyleTemplateId || null
    const result = (templateId: string | null, source: TemplateSource | null): TemplateInUse => ({ templateId, source, outputStyleOverride })

    const slide = input.slide
    const firstSlideId = input.firstSlideTemplateId || ""
    const isFirst = !!slide?.isFirstSlide

    if (slide) {
        if (slide.slideTemplateId) {
            // the first slide template is stored as the slide's own template on the first slide
            if (isFirst && firstSlideId && slide.slideTemplateId === firstSlideId) return result(slide.slideTemplateId, "first-slide")
            return result(slide.slideTemplateId, "slide")
        }
        if (slide.groupTemplateId) return result(slide.groupTemplateId, "group")
        if (isFirst && firstSlideId) return result(firstSlideId, "first-slide")
    }

    if (input.categoryTemplateId && known(input.categoryTemplateId)) return result(input.categoryTemplateId, "category")
    if (input.showTemplateId) return result(input.showTemplateId, "show")

    return result(null, null)
}

export interface ClickTargetInput {
    /** Number of selected slides in the active show. 0 when no slides are selected. */
    selectedSlideCount: number
    totalSlideCount: number
}

export interface ClickTarget {
    scope: ApplyScope
    count: number
    label: string
    /** Translation key for the scope. */
    labelKey: "template_use.whole_show" | "template_use.selected_slides"
}

/** Selecting every slide counts as a whole-show apply, as the Templates drawer does today. */
export function describeTemplateClickTarget(input: ClickTargetInput): ClickTarget {
    const selected = Math.max(0, input.selectedSlideCount)
    const total = Math.max(0, input.totalSlideCount)

    if (selected > 0 && selected < total) {
        return { scope: "slides", count: selected, label: selected === 1 ? "1 selected slide" : `${selected} selected slides`, labelKey: "template_use.selected_slides" }
    }

    return { scope: "show", count: total, label: "Whole show", labelKey: "template_use.whole_show" }
}

export interface ApplyBlockInput {
    scope: ApplyScope
    showLocked?: boolean
    readOnly?: boolean
    categoryTemplateId?: string | null
}

/** The category block only stops whole-show applies; selected slides can still be restyled. */
export function getTemplateApplyBlock(input: ApplyBlockInput): ApplyBlock {
    if (input.showLocked) return "show_locked"
    if (input.readOnly) return "read_only"
    if (input.scope === "show" && input.categoryTemplateId) return "category_template"
    return null
}
