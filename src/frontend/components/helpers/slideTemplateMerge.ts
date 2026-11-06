// Slide template merging: merges slide items with template items, applies template settings to
// slides/layouts and sorts items by type. Pure data in, data out: no store access. Callers read
// stores (overlays, scripture settings) and pass the values in.

import { uid } from "uid"
import type { Item, Layout, LayoutRef, Media, Slide, Template } from "../../../types/Show"
import { areObjectsEqual, clone, getFileName, getItemText, removeExtension } from "./pureHelpers"
import { getStyles } from "./style"

const DEFAULT_VERSE_NUMBER_COLOR = "#919191"

export type DynamicValues = { [key: string]: string | [string, string][] }

export type MergeWithTemplateOptions = {
    /** scripture verse number color (from scripture settings), used when replacing scripture dynamic values */
    scriptureNumberColor?: string
}

type TextFormatSets = {
    colors: Set<string>
    bold: Set<boolean>
    italic: Set<boolean>
    underline: Set<boolean>
    lineThrough: Set<boolean>
}

function isTextBold(fontWeight = "") {
    const lowerWeight = fontWeight.toLowerCase()
    if (lowerWeight === "bold") return true

    const numericWeight = Number(lowerWeight)
    return !isNaN(numericWeight) && numericWeight >= 600
}

function hasTextDecoration(textDecoration = "", value = "") {
    return textDecoration
        .split(" ")
        .map((a) => a.trim().toLowerCase())
        .includes(value)
}

function mergeTextDecoration(templateTextStyle = "", originalTextStyle = "", preserveUnderline = false, preserveLineThrough = false) {
    const templateStyles = getStyles(templateTextStyle)
    const originalStyles = getStyles(originalTextStyle)

    const toDecorationSet = (value = "") =>
        new Set(
            value
                .split(" ")
                .map((a) => a.trim().toLowerCase())
                .filter(Boolean)
        )

    const templateDecorations = toDecorationSet(templateStyles["text-decoration"])
    const originalDecorations = toDecorationSet(originalStyles["text-decoration"])

    ;(
        [
            [preserveUnderline, "underline"],
            [preserveLineThrough, "line-through"]
        ] as const
    ).forEach(([preserve, decoration]) => {
        if (!preserve) return
        if (originalDecorations.has(decoration)) templateDecorations.add(decoration)
        else templateDecorations.delete(decoration)
    })

    if (!templateDecorations.size) return "none"

    return Array.from(templateDecorations).join(" ")
}

function applyMixedTextFormatting(style: string, textStyle: string | undefined, templateStyle: string | undefined, textFormatSets: TextFormatSets, templateClicked: boolean) {
    if (templateClicked) return style

    const textStyles = getStyles(textStyle)

    // add original text color, if template is not clicked & slide text has multiple colors
    // - use template color if item text has just one color
    if (textFormatSets.colors.size > 1) {
        const textColor = textStyles.color || "#FFFFFF"
        style += `color: ${textColor};`
    }

    if (textFormatSets.bold.size > 1) {
        const isBold = isTextBold(textStyles["font-weight"] || "")
        style += `font-weight: ${isBold ? textStyles["font-weight"] || "bold" : "normal"};`
    }

    if (textFormatSets.italic.size > 1) {
        const isItalic = (textStyles["font-style"] || "").toLowerCase() === "italic"
        style += `font-style: ${isItalic ? "italic" : "normal"};`
    }

    if (textFormatSets.underline.size > 1 || textFormatSets.lineThrough.size > 1) {
        const textDecoration = mergeTextDecoration(templateStyle || "", textStyle || "", textFormatSets.underline.size > 1, textFormatSets.lineThrough.size > 1)
        style += `text-decoration: ${textDecoration};`
    }

    return style
}

function getTextFormatSets(item: Item): TextFormatSets {
    return (
        item.lines?.reduce(
            (acc, line) => {
                line.text
                    ?.filter((a) => !a.customType)
                    .forEach((text) => {
                        const styleData = getStyles(text.style)
                        const textDecoration = styleData["text-decoration"] || ""

                        acc.colors.add(styleData.color || "#FFFFFF")
                        acc.bold.add(isTextBold(styleData["font-weight"] || ""))
                        acc.italic.add((styleData["font-style"] || "").toLowerCase() === "italic")
                        acc.underline.add(hasTextDecoration(textDecoration, "underline"))
                        acc.lineThrough.add(hasTextDecoration(textDecoration, "line-through"))
                    })

                return acc
            },
            { colors: new Set<string>(), bold: new Set<boolean>(), italic: new Set<boolean>(), underline: new Set<boolean>(), lineThrough: new Set<boolean>() }
        ) || { colors: new Set<string>(), bold: new Set<boolean>(), italic: new Set<boolean>(), underline: new Set<boolean>(), lineThrough: new Set<boolean>() }
    )
}

export function mergeWithTemplate(slideItems: Item[], templateItems: Item[], addOverflowTemplateItems = false, resetAutoSize = true, templateClicked = false, mode: string = "", customDynamicValues: DynamicValues = {}, options: MergeWithTemplateOptions = {}) {
    slideItems = clone(slideItems || []).filter(Boolean)
    if (!templateItems.length) return slideItems

    // only get items that are not from a template
    slideItems = slideItems.filter((a) => !a.fromTemplate)

    const originalTemplateItems = templateItems

    // it's the wrong way around when a template is converted to a slide/output, but it breaks more than it fixes at this time.
    // should be reversed, but people have to invert the order of their template items order.
    templateItems = clone(templateItems) // .reverse()

    if (resetAutoSize) {
        templateItems.forEach((item) => {
            if (!item) return
            delete item.autoFontSize
        })
    }

    const sorted = sortItemsByType(templateItems)
    const sortedTemplateItems = clone(sorted)

    const hasScriptureDynamicValue = Object.keys(customDynamicValues).length && templateItems?.some((item) => item?.lines?.some((line) => line?.text?.some((text) => text.value?.includes("{scripture"))))

    // reduce template textboxes to slide items
    const slideTextboxes = hasScriptureDynamicValue ? 0 : slideItems.reduce((count, a) => (count += (a?.type || "text") === "text" ? 1 : 0), 0)
    if (!templateClicked && slideTextboxes < (sortedTemplateItems.text?.length || 0)) {
        sortedTemplateItems.text = sortedTemplateItems.text.slice(0, slideTextboxes)
    }

    // remove slide items if no text
    if (addOverflowTemplateItems && templateItems.length < slideItems.length) {
        slideItems = slideItems.filter((a) => (a?.type || "text") !== "text" || getItemText(a).length)
    }

    let newSlideItems: Item[] = []
    slideItems.forEach((item: Item) => {
        if (!item) return

        const type = item.type || "text"
        if (type === "text" && hasScriptureDynamicValue) return

        const templateItem = clone(sortedTemplateItems[type]?.shift())
        if (!templateItem) return finish()

        item.style = templateItem.style || ""
        item.align = templateItem.align || ""

        // use template image unless it's empty
        if (type === "media" && templateItem.src) item.src = templateItem.src

        // don't alter text if item mode
        if (mode === "item") return finish()

        if (resetAutoSize) delete item.autoFontSize

        // Handle auto and textFit properties
        if (templateItem.auto !== undefined) {
            // Template explicitly defines auto
            item.auto = templateItem.auto
        } else if (templateItem.textFit) {
            // Template has textFit but not auto - enable auto (textFit implies auto-sizing)
            if (templateItem.textFit !== "none") item.auto = true
        } else if (templateItem.auto === undefined && templateItem.textFit === undefined) {
            // Template defines neither - disable auto-sizing (simple static template)
            item.auto = false
            delete item.textFit
        }

        // Apply textFit if template defines it
        if (templateItem.textFit) item.textFit = templateItem.textFit
        else if (!templateItem.auto) delete item.textFit
        if (templateItem.list) item.list = templateItem.list
        else delete item.list

        // use original line reveal if style template does not have the value set
        const hasLineReveal = item.lineReveal
        if (hasLineReveal && !addOverflowTemplateItems) templateItem.lineReveal = true
        // const hasClickReveal = item.clickReveal
        // if (hasClickReveal) templateItem.clickReveal = true

        // remove exiting styling & add new if set in template
        // WIP some keys are probably missing here...
        // NOTE: textFit is already handled above in the auto/textFit logic block
        const extraStyles = ["chords", "actions", "specialStyle", "scrolling", "bindings", "conditions", "clickReveal", "lineReveal", "fit", "filter", "flipped", "flippedY"]
        extraStyles.forEach((key) => {
            delete item[key]
            if (templateItem[key]) item[key] = templateItem[key]
        })

        if (type !== "text") return finish()

        const textFormatSets = getTextFormatSets(item)

        const hasDynamicValue = templateItem?.lines?.some((line) => line?.text?.some((text) => text.value?.includes("{")))

        item.lines?.forEach((line, j) => {
            let templateLine = templateItem?.lines?.[j] || templateItem?.lines?.[0]
            if (!templateLine) return

            // remove empty text parts (if not completely empty)
            if (templateLine.text.some((a) => a?.value?.trim().length)) templateLine.text = templateLine.text.filter((a) => a?.value?.trim().length)

            line.align = templateLine?.align || ""
            line.text?.forEach((text, k) => {
                const templateText = templateLine?.text?.[k] || templateLine?.text?.[0]

                if (!text.customType?.includes("disableTemplate") && !/\{scripture(?:\d+)?_number\}/.test(templateText?.value || "")) {
                    let style = templateText?.style || ""
                    style = applyMixedTextFormatting(style, text.style, templateText?.style, textFormatSets, templateClicked)

                    text.style = style
                }

                const firstChar = templateText?.value?.[0] || ""

                // add dynamic values
                if ((!text.value?.length || text.value?.includes("{")) && hasDynamicValue && templateItem?.lines?.[j]) {
                    text.value = templateText!.value
                }

                if (!text.value?.[0]) return

                // add bullets
                if (firstChar === "•" || firstChar === "-") {
                    if (text.value[0] === firstChar) return
                    line.text[k].value = `${firstChar} ${text.value.trim()}`
                } else if (addOverflowTemplateItems && (text.value[0] === "•" || text.value[0] === "-")) {
                    // remove bullets
                    line.text[k].value = text.value.replace(text.value[0], "").trim()
                }
            })

            // remove empty values
            // line.text = line.text?.filter((a) => a?.value?.length) || []
        })

        finish()
        function finish() {
            newSlideItems.push(item)
        }
    })

    if (addOverflowTemplateItems || hasScriptureDynamicValue) {
        const remainingTextTemplateItems = sorted.text?.slice(slideTextboxes) || []

        if (hasScriptureDynamicValue) {
            remainingTextTemplateItems.forEach((item) => {
                // check if item has scripture value (and not {scripture_text})
                const regex = /\{scripture(?:\d+)?_[^}]+\}/g
                const text = getItemText(item)
                const isDecoration = (() => {
                    const matches = text?.match(regex)
                    if (!matches) return false
                    return matches.every((a) => !a.includes("_text}"))
                })()
                if (isDecoration) {
                    // prevent easy edit
                    item.decoration = true
                }
            })
        }

        sortedTemplateItems.text = removeTextValue(remainingTextTemplateItems)
    } else {
        delete sortedTemplateItems.text

        // // don't add overflow textboxes that are not empty or does not have a dynamic value ({) ?
        // sortedTemplateItems.text = sortedTemplateItems.text.filter(a => {
        //     const text = getItemText(a)
        //     return !text || text.includes("{")
        // })
    }

    // remove textbox items
    templateItems = templateItems.filter((a) => (a.type || "text") !== "text")
    // remove any duplicate values
    templateItems = templateItems.filter(
        (item) =>
            !newSlideItems.find((a) => {
                const currentItem = clone(a)
                delete currentItem.align
                delete currentItem.auto
                delete currentItem.autoFontSize
                delete currentItem.fromTemplate

                return areObjectsEqual(currentItem, item)
            })
    )

    // this will ensure the correct order on the remaining items
    const remainingCount = Object.values(sortedTemplateItems).reduce((value, items) => (value += items.length), 0)
    let remainingTemplateItems = remainingCount ? templateItems.slice(remainingCount * -1) : []
    // add template marker
    remainingTemplateItems = remainingTemplateItems.map((a) => ({ ...a, fromTemplate: true }))
    // add behind existing items (any textboxes previously on top not in use will not be replaced by any underneath)
    newSlideItems = [...remainingTemplateItems, ...newSlideItems, ...(sortedTemplateItems.text || [])]

    newSlideItems = replaceScriptureValues(newSlideItems, originalTemplateItems, customDynamicValues, options.scriptureNumberColor)

    return newSlideItems // .reverse()
}

// WIP duplicate of getScriptureSlidesNew section in scripture.ts
function replaceScriptureValues(items: Item[], templateItems: Item[], customDynamicValues: DynamicValues = {}, scriptureNumberColor?: string) {
    if (Object.keys(customDynamicValues).length) {
        // extra styles
        let verseNumberSize = 50 // get(scriptureSettings).numberSize || 50 // %
        let verseNumberStyle = `color: ${scriptureNumberColor || DEFAULT_VERSE_NUMBER_COLOR};text-shadow: none;`
        let verseNumberStyles: string[] = []
        let baseStyle = ""

        // find any text object with {scripture_number} and get the style
        templateItems.forEach((item) => {
            item.lines?.forEach((line) => {
                line.text?.forEach((textObj) => {
                    for (let i = 0; i <= 4; i++) {
                        const numberValue = `{scripture${i === 0 ? "" : i}_number}`
                        if (textObj.value?.includes(numberValue)) verseNumberStyles[i] = textObj.style || ""
                    }
                    if (textObj.value?.includes("{scripture_text}")) {
                        const textStyle = textObj.style || ""
                        if (textStyle && (item.textFit || "none") === "none") baseStyle = textStyle
                    }
                })
            })
        })

        // set custom dynamic values (scripture)
        let slideString = JSON.stringify(items)
        Object.keys(customDynamicValues).forEach((key) => {
            const value = customDynamicValues[key]
            if (typeof value === "string") {
                slideString = slideString.replace(new RegExp(`{${key}}`, "g"), value)
            }
        })

        // remove style only values
        for (let i = 0; i <= 4; i++) {
            const numberValue = `{scripture${i === 0 ? "" : i}_number}`
            slideString = slideString.replaceAll(`${numberValue} `, "").replaceAll(numberValue, "")
        }

        items = JSON.parse(slideString)

        Object.keys(customDynamicValues).forEach((key) => {
            const value = customDynamicValues[key]
            if (Array.isArray(value)) {
                // verse content [number, text]
                items.forEach((item) => {
                    item.lines?.forEach((line) => {
                        const newTexts: { value: string; style: string; sourceDynamicKey?: string; customType?: string }[] = []
                        let insertAtPos = -1

                        // remove empty values (if {scripture_text})
                        if (line.text?.reduce((value, text) => (value += text.value), "")?.includes("_text}")) {
                            line.text = (line.text || []).filter((text) => text.value?.trim())
                        }

                        line.text?.forEach((text, i) => {
                            if (text.value?.includes(`{${key}}`)) {
                                insertAtPos = i
                                text.value = "" // remove original text
                                const style = text.style || ""

                                const bibleIndex = parseInt(key.replace(/\D/g, "")) || 0

                                value.forEach(([number, value], index) => {
                                    if (number && number !== "0") {
                                        const size = verseNumberSize * (i === 0 ? 1.2 : 1)
                                        const numberStyle = `;${verseNumberStyles[bibleIndex] || verseNumberStyles[0] || verseNumberStyle}font-size: ${size}px;margin-right: 0.3em;`
                                        newTexts.push({ value: number, style: style + numberStyle, customType: "disableTemplate" })
                                    }

                                    newTexts.push({ value, sourceDynamicKey: key + ":" + index, style: style + ";" + baseStyle })
                                })
                            }
                        })

                        if (insertAtPos > -1) {
                            line.text = [...line.text.slice(0, insertAtPos), ...newTexts, ...line.text.slice(insertAtPos + 1)]
                        }
                    })
                })
            }
        })

        // remove empty values
        items.forEach((item) => {
            item.lines?.forEach((line) => {
                line.text = line.text?.filter((text) => text.value) || []
            })
        })
    }

    return items
}

export function updateSlideFromTemplate(slide: Slide, template: Template, isFirst = false, removeOverflow = false, firstTemplateId?: string, overlayItems: Item[] = []) {
    const settings = template.settings || {}
    if (!slide.settings) slide.settings = {}

    // if (settings.resolution || slide.settings.resolution) slide.settings.resolution = getResolution(settings.resolution)
    const firstTemplate = firstTemplateId ?? settings.firstSlideTemplate
    if (isFirst && (firstTemplate || removeOverflow)) slide.settings.template = firstTemplate || ""
    if (settings.backgroundColor || slide.settings.color) slide.settings.color = settings.backgroundColor || ""

    // add overlay items to slide items
    if (removeOverflow && settings.overlayId) {
        slide.items.push(...overlayItems)
    }

    return slide
}

export function updateLayoutsFromTemplate(layouts: { [key: string]: Layout }, media: { [key: string]: Media }, template: Template, oldTemplate: Template, layoutId: string, slideRef: LayoutRef, templateMode: "global" | "group" | "slide", removeOverflow = false) {
    if (typeof layouts !== "object") layouts = {}
    if (typeof media !== "object") media = {}

    // only alter layout slides if clicking on the template
    if (templateMode === "global" && !removeOverflow) return { layouts, media }

    // no need to add background/actions to slide/group children
    if (slideRef.type !== "parent") return { layouts, media }

    const slideIndex = slideRef.index
    if (!layouts[layoutId]?.slides?.[slideIndex]) return { layouts, media }

    const slide = layouts[layoutId].slides[slideIndex]
    const settings = template.settings || {}
    const oldSettings = oldTemplate.settings || {}

    let bgId = ""
    if (settings.backgroundPath) {
        // find existing
        const existingId = Object.keys(media).find((id) => (media[id].path || media[id].id) === settings.backgroundPath)
        bgId = existingId || uid()
        if (!existingId) media[bgId] = { path: settings.backgroundPath, name: removeExtension(getFileName(settings.backgroundPath)) }
    } else if ((templateMode !== "global" || slideIndex === 0) && oldSettings.backgroundPath && oldSettings.backgroundPath === media[slide.background || ""]?.path) {
        // remove background if previous template has current background
        if (slide.background) slide.background = ""
    }

    if (settings.backgroundPath) slide.background = bgId
    if (settings.actions?.length) {
        if (!slide.actions) slide.actions = {}

        // remove existing
        const newSlideActions: any[] = []
        slide.actions.slideActions?.forEach((action) => {
            if (settings.actions?.find((a) => a.id === action.id || a.triggers?.[0] === action.triggers?.[0])) return
            newSlideActions.push(action)
        })

        slide.actions.slideActions = [...newSlideActions, ...settings.actions]
    }

    layouts[layoutId].slides[slideIndex] = slide
    return { layouts, media }
}

function removeTextValue(items: Item[]) {
    items.forEach((item) => {
        if (!item.lines) return

        // && !text.value?.includes("{scripture")
        const hasDynamicValue = item.lines.some((line) => line.text?.some((text) => text.value?.includes("{")))

        item.lines = item.lines.map((line) => {
            if (hasDynamicValue) return { align: line.align, text: line.text }
            return { align: line.align, text: [{ style: line.text?.[0]?.style, value: "" }] }
        })
    })

    return items
}

export function getTemplateText(value: string | undefined) {
    // if text has {} it will not get removed (useful for preset text, and dynamic values)
    if (value?.includes("{")) return value
    return ""
}

export function isEmptyOrSpecial(item: Item) {
    const text = getItemText(item)
    if (!text.length) return true
    if (getTemplateText(text)) return true

    return false
}

export function isEmpty(item: Item) {
    return !getItemText(item).length
}

export function sortItemsByType(items: Item[]) {
    const sortedItems: { [key: string]: Item[] } = {}

    items.forEach((item) => {
        if (!item) return

        const type = item.type || "text"
        if (!sortedItems[type]) sortedItems[type] = []

        sortedItems[type].push(item)
    })

    return sortedItems
}

export function getItemsCountByType(items: Item[]) {
    const sortedItems = sortItemsByType(items)
    const typeCount: { [key: string]: number } = {}

    Object.keys(sortedItems).forEach((type) => {
        typeCount[type] = sortedItems[type].length
    })

    return typeCount
}
