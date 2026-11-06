<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import { resolveTemplateInUse } from "../../../../common/templates/templateInUse"
    import type { Item, ItemType, Show, Slide } from "../../../../types/Show"
    import { activeEdit, activePopup, activeShow, alertMessage, categories, groups, styles as outputStyles, overlays, selected, shownTips, showsCache, special, templates, theme, themes, timers } from "../../../stores"
    import { newToast } from "../../../utils/common"
    import { translateText } from "../../../utils/language"
    import { showEntry } from "../../../utils/perEntryStores"
    import { getNormalizedKey, isFormattingKey } from "../../../utils/shortcuts"
    import { clone } from "../../helpers/array"
    import { history } from "../../helpers/history"
    import { getExtension, getMediaType } from "../../helpers/media"
    import { getAllEnabledOutputs } from "../../helpers/output"
    import { getCustomMetadata, getLayoutRef, initializeMetadata, isSlideLocked } from "../../helpers/show"
    import { _show } from "../../helpers/shows"
    import { getStyles } from "../../helpers/style"
    import { MAX_FONT_SIZE } from "../scripts/autosize"
    import { addFilterString, addStyle, addStyleString, getItemStyleAtPos, getItemText, getLastLineAlign, getLineText, getSelectionRange } from "../scripts/textStyle"
    import { getOwnTextStyleSlideIds, matchItemIndexes, resetTextStyleToTemplate, type TextScope } from "../scripts/textScope"
    import { itemBoxes, setBoxInputValue } from "../values/boxes"
    import EditValues from "./EditValues.svelte"
    import TextScopeControl from "./TextScopeControl.svelte"
    import TextScopeFooter from "./TextScopeFooter.svelte"

    export let id: ItemType
    export let allSlideItems: Item[] = []
    export let item: Item | null = null

    // -----

    // selection
    let selection: null | { start: number; end: number }[] = null
    let activeRowIdx = -1
    let activeColIdx = -1
    const unsubscribe = activeEdit.subscribe((a) => {
        if (!a.items.length) {
            selection = null
        }
    })
    onDestroy(unsubscribe)

    let selectionChangeListener: null | (() => void) = null

    onMount(() => {
        getTextSelection()

        selectionChangeListener = () => getTextSelection()
        document.addEventListener("selectionchange", selectionChangeListener)

        // set focus to textbox if only one without content
        if (allSlideItems.length === 1 && item && !getItemText(item).length && !$activeEdit.items.length) {
            activeEdit.update((a) => ({ ...(a || {}), items: [0] }))
            const elem = document.querySelector(".editItem")?.querySelector(".edit")
            if (elem) (elem as HTMLElement).focus()
        }
    })

    onDestroy(() => {
        if (selectionChangeListener) document.removeEventListener("selectionchange", selectionChangeListener)
    })

    function getTextSelection(e: any = null) {
        if (e) {
            if (e.target.closest(".menus") || e.target.closest(".popup") || e.target.closest(".drawer") || e.target.closest(".chords") || e.target.closest(".contextMenu") || e.target.closest(".editTools")) return
        }

        const activeEl = document.activeElement as HTMLElement | null
        if (activeEl?.closest(".tools") || activeEl?.closest(".menus") || activeEl?.closest(".popup") || activeEl?.closest(".drawer") || activeEl?.closest(".chords") || activeEl?.closest(".contextMenu") || activeEl?.closest(".editTools") || document.querySelector(".editTools:hover")) return

        let sel = window.getSelection()

        if (sel?.type === "None") {
            if (activeEl === document.body) return
            selection = null
            activeRowIdx = -1
            activeColIdx = -1
            return
        }

        const anchorElem = (sel?.anchorNode as Element)?.nodeType === Node.ELEMENT_NODE ? (sel?.anchorNode as Element) : sel?.anchorNode?.parentElement
        if (!anchorElem?.closest?.(".edit")) {
            activeRowIdx = -1
            activeColIdx = -1
            return
        }

        const cellEditElem = anchorElem?.closest(".cell-content.edit")
        const td = cellEditElem?.closest("td")
        activeRowIdx = td ? parseInt(td.getAttribute("data-row") || "") : -1
        activeColIdx = td ? parseInt(td.getAttribute("data-col") || "") : -1

        selection = getSelectionRange() // range
    }

    function mousedown(e: any) {
        // store if going to a text input in the tools
        if (e.target.closest(".tools") || e.target.closest(".menus") || e.target.closest(".popup") || e.target.closest(".drawer") || e.target.closest(".chords") || e.target.closest(".contextMenu") || e.target.closest(".editTools")) getTextSelection(e)
    }

    function keyup(e: KeyboardEvent) {
        if (e.key.includes("Arrow") || e.key === "Home" || e.key === "End" || getNormalizedKey(e).toUpperCase() === "A") getTextSelection(e)
    }

    const formatting = {
        b: () => ({ id: "style", key: "font-weight", value: "bold" }),
        i: () => ({ id: "style", key: "font-style", value: "italic" }),
        u: () => ({ id: "style", key: "text-decoration", value: "underline" })
    }

    function getFormattingShortcut(e: KeyboardEvent) {
        if (!isFormattingKey(e)) return null
        return formatting[getNormalizedKey(e).toLowerCase()] || null
    }

    function getSelectionPoint(editElem: Element, line: number, pos: number) {
        const lineElem = editElem.childNodes[line]
        if (!lineElem) return null

        let count = 0
        const lineChildren = Array.from(lineElem.childNodes)
        for (const [childIndex, child] of lineChildren.entries()) {
            const textLength = (child as HTMLElement).innerText?.replaceAll("\n", "")?.length ?? child.textContent?.length ?? 0
            const isLastChild = childIndex === lineChildren.length - 1
            if (pos <= count + textLength || isLastChild) {
                const localOffset = Math.max(0, pos - count)

                // child can be a raw #text node or an element containing text.
                if (child.nodeType === Node.TEXT_NODE) {
                    const nodeLength = child.textContent?.length ?? 0
                    return { node: child, offset: Math.min(nodeLength, localOffset) }
                }

                const textNode = child.childNodes?.[0]
                if (!textNode || textNode.nodeName === "BR") return { node: child, offset: 0 }

                if (textNode.nodeType === Node.TEXT_NODE) {
                    const nodeLength = textNode.textContent?.length ?? 0
                    return { node: textNode, offset: Math.min(nodeLength, localOffset) }
                }

                const nodeLength = textNode.textContent?.length ?? 0
                return { node: textNode, offset: Math.min(nodeLength, localOffset) }
            }

            count += textLength
        }

        return null
    }

    function isSelectionBackward(sel: Selection) {
        if (!sel.anchorNode || !sel.focusNode) return false
        if (sel.anchorNode === sel.focusNode) return sel.anchorOffset > sel.focusOffset

        const position = sel.anchorNode.compareDocumentPosition(sel.focusNode)
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return true
        return false
    }

    function restoreTextSelection(editElem: Element, savedSelection: { start: number; end: number }[], keepBackwardSelection = false) {
        const selectedLines = savedSelection.map((line, i) => ({ ...line, line: i })).filter((line) => line.start !== undefined && line.end !== undefined)

        if (!selectedLines.length) return false

        const first = selectedLines[0]
        const last = selectedLines[selectedLines.length - 1]
        const startPoint = getSelectionPoint(editElem, first.line, first.start)
        const endPoint = getSelectionPoint(editElem, last.line, last.end)
        if (!startPoint || !endPoint) return false

        const range = document.createRange()
        try {
            range.setStart(startPoint.node, startPoint.offset)
            range.setEnd(endPoint.node, endPoint.offset)
        } catch {
            return false
        }

        const sel = window.getSelection()
        if (!sel) return false

        if (sel.setBaseAndExtent) {
            if (keepBackwardSelection) sel.setBaseAndExtent(endPoint.node, endPoint.offset, startPoint.node, startPoint.offset)
            else sel.setBaseAndExtent(startPoint.node, startPoint.offset, endPoint.node, endPoint.offset)
        } else {
            sel.removeAllRanges()
            sel.addRange(range)
        }

        return true
    }

    function keydown(e: KeyboardEvent) {
        const shortcut = getFormattingShortcut(e)
        if ((!e.ctrlKey && !e.metaKey) || !shortcut) return

        const liveSelection = getSelectionRange()
        const hasSelectionRange = !!liveSelection?.some((line) => line.start !== undefined && line.end !== undefined && line.start !== line.end)
        if (!hasSelectionRange) return

        e.preventDefault()

        const selectionSnapshot = liveSelection.map((line) => ({ ...line }))
        selection = selectionSnapshot.map((line) => ({ ...line }))
        const currentDomSelection = window.getSelection()
        const backwardSelection = currentDomSelection ? isSelectionBackward(currentDomSelection) : false

        let value = shortcut()

        if (value.key === "text-decoration") {
            // don't remove line-through if underline is toggled
            const currentVal = styles[value.key] || ""
            let parts = currentVal.split(" ").filter((p: string) => p)
            if (parts.includes(value.value)) parts = parts.filter((p: string) => p !== value.value)
            else parts.push(value.value)
            value.value = parts.join(" ")
        } else if (styles[value.key]?.includes(value.value)) {
            value.value = ""
        }

        updateValue({ detail: value })

        requestAnimationFrame(() => {
            const editElem = document.querySelector(".editArea")?.querySelectorAll(".editItem")?.[$activeEdit.items[0]]?.querySelector(".edit")
            if (!editElem) return

            restoreTextSelection(editElem, selectionSnapshot, backwardSelection)

            selection = selectionSnapshot.map((line) => ({ ...line }))
        })
    }

    // -----

    const setItemStyle = ["timer", "clock", "icon", "events", "camera", "variable", "web", "slide_tracker", "table"]

    const setBox = () => clone(itemBoxes[id])!
    let box = setBox()
    $: if ($activeEdit.id || $activeShow?.id || ($activeEdit.slide ?? -1) > -1) box = setBox()

    // get item values
    $: style = item?.lines ? getItemStyleAtPos(item.lines, selection) : item?.type === "table" && activeRowIdx >= 0 && activeColIdx >= 0 && item.table?.rows?.[activeRowIdx]?.cells?.[activeColIdx] ? item.table.rows[activeRowIdx].cells[activeColIdx].style || "" : item?.style || ""
    let styles: any = {}
    $: if (style !== undefined) styles = getStyles(style, true)

    $: lineAlignStyle = item?.lines ? getStyles(getLastLineAlign(item, selection)) : getStyles(item?.align)
    $: alignStyle = item?.align ? getStyles(item.align) : {}

    $: customValues = {
        "text-align": lineAlignStyle["text-align"] || "center",
        "align-items": alignStyle["align-items"] || "center"
    }

    /// SET INPUT VALUES ///

    // remove chord options
    $: if ($activeEdit.type === "overlay" && box?.sections?.chords) {
        delete box.sections.chords
    }

    $: if (box?.sections?.CSS && id !== "captions") {
        setBoxInputValue(box, "CSS", "CSS_text", "value", style)
    }

    $: if (box?.sections?.font) {
        setBoxInputValue(box, "font", "font-size", "disabled", item?.textFit !== "none")
        setBoxInputValue(box, "font", "textFit", "value", item?.textFit || (id === "table" ? "none" : "growToFit")) // other items (like clock, timer)
        // setBoxInputValue(box2, "font", "auto", "value", item.auto ?? true)
    }

    $: if (id === "text") {
        setBoxInputValue(box, "default", "font-family", "styleValue", getStyles(style)["font"] || "")
        // setBoxInputValue(box2, "default", "textFit", "hidden", !item?.auto)
        setBoxInputValue(box, "text", "nowrap", "value", !!styles["white-space"]?.includes("nowrap"))
        setBoxInputValue(box, "lines", "specialStyle.lineRadius", "hidden", !item?.specialStyle?.lineRadius && !item?.specialStyle?.lineBg)

        setBoxInputValue(box, "default", "textFit", "value", item?.auto ? "shrinkToFit" : "none") // text items
    }

    $: if (id === "media" && item) {
        const extension = getExtension(item.src || "")
        const isVideo = getMediaType(extension) === "video"
        setBoxInputValue(box, "default", "muted", "hidden", !isVideo)
        setBoxInputValue(box, "default", "loop", "hidden", !isVideo)
        setBoxInputValue(box, "default", "speed", "hidden", !isVideo)
    }

    $: if (id === "timer" && item) {
        setBoxInputValue(box, "default", "timer.circleMask", "hidden", item.timer?.viewType !== "circle")
        const timer = $timers[item.timer?.id || ""]
        const timerLength = Math.abs((timer?.start || 0) - (timer?.end || 0))
        setBoxInputValue(box, "default", "timer.showHours", "value", item.timer?.showHours !== false)
        setBoxInputValue(box, "default", "timer.showHours", "hidden", (item.timer?.viewType || "time") !== "time" || timerLength < 3600)
        setBoxInputValue(box, "default", "timer.padding", "value", item.timer?.padding !== false)
        setBoxInputValue(box, "default", "timer.padding", "hidden", (item.timer?.viewType || "time") !== "time")
    }
    $: if (id === "clock" && item) {
        const clockType = item.clock?.type || "digital"
        const dateFormat = item.clock?.dateFormat || "none"
        const customFormat = item.clock?.customFormat || ""
        const showOffsetDays = clockType === "custom" && /[MDY]/.test(customFormat) // has M or D or Y

        setBoxInputValue(box, "default", "clock.dateFormat", "hidden", clockType !== "digital")
        setBoxInputValue(box, "default", "clock.showTime", "hidden", clockType !== "digital" || dateFormat === "none")
        setBoxInputValue(box, "default", "clock.seconds", "hidden", clockType === "custom" || (clockType === "digital" && item.clock?.showTime === false && dateFormat !== "none"))
        setBoxInputValue(box, "default", "clock.customFormat", "hidden", clockType !== "custom")
        setBoxInputValue(box, "default", "clock.offsetDays", "hidden", !showOffsetDays)
        setBoxInputValue(box, "default", "tip", "hidden", clockType !== "custom")
    }
    $: if (id === "camera" && item) {
        if (item.device?.name) setBoxInputValue(box, "default", "device", "name", item.device.name)
    }
    $: if (id === "slide_tracker" && item) {
        setBoxInputValue(box, "default", "tracker.accent", "value", item.tracker?.accent || $themes[$theme]?.colors?.secondary || "#F0008C")

        const defaultMetadataKeys = Object.keys(initializeMetadata({}))
        const metadataOptions = [{ value: "name", label: "show.name" }, ...Object.keys(getCustomMetadata()).map((key) => ({ value: key, label: defaultMetadataKeys.includes(key) ? `meta.${key}` : key }))]
        setBoxInputValue(box, "default", "tracker.projectMetadata", "options", metadataOptions)

        setBoxInputValue(box, "default", "tracker.childProgress", "hidden", item.tracker?.type !== "group")
        setBoxInputValue(box, "default", "tracker.oneLetter", "hidden", item.tracker?.type !== "group")
        setBoxInputValue(box, "default", "tracker.projectMetadata", "hidden", item.tracker?.type !== "project")
    }
    $: if (id === "events" && item) {
        setBoxInputValue(box, "default", "events.startDaysFromToday", "disabled", !!item.events?.enableStartDate)
        setBoxInputValue(box, "default", "events.startDate", "hidden", !item.events?.enableStartDate)
        setBoxInputValue(box, "default", "events.startTime", "hidden", !item.events?.enableStartDate)
        setBoxInputValue(box, "default", "events.fromTime", "hidden", !item.events?.justOneDay)
        setBoxInputValue(box, "default", "events.toTime", "hidden", !item.events?.justOneDay)
    }
    $: if (id === "chart" && item) {
        setBoxInputValue(box, "default", "chart.holeSize", "hidden", item.chart?.type !== "pie")
        setBoxInputValue(box, "default", "chart.holeSize", "value", item.chart?.holeSize ?? 0)
    }

    ///

    function setValue(input: any, allItems: any[], forced: ForcedScope | null = null) {
        const activeScope = getActiveScope(forced)
        let value: any = input.value
        if (input.id === "filter") value = addFilterString(item?.filter || "", [input.key, value])
        else if (input.id === "align" && item?.type === "table") value = addStyleString(item?.align || "", [input.key, value])
        else if (input.key === "text-align") value = `text-align: ${value};`
        else if (input.key) value = { ...((item as any)?.[input.key] || {}), [input.key]: value }

        let targetId = input.id
        // set nested value
        if (input.id.includes(".")) {
            let splitted = input.id.split(".")
            let item = getSelectedItem()
            if (!item) return

            targetId = splitted[0]

            let newValue = item[splitted[0]]
            if (typeof newValue !== "object" || newValue === null) newValue = {}
            else newValue = clone(newValue)

            newValue[splitted[1]] = input.value
            value = newValue
        }

        function getSelectedItem() {
            if ($activeEdit.id) {
                if ($activeEdit.type === "overlay") {
                    return clone($overlays[$activeEdit.id]?.items?.[allItems[0]])
                } else if ($activeEdit.type === "template") {
                    return clone($templates[$activeEdit.id]?.items?.[allItems[0]])
                }
            }

            let slideId = getLayoutRef()[$activeEdit.slide!]?.id
            let slide = clone(_show().slides([slideId]).get()[0]) as Slide

            return slide?.items?.[allItems[0]]
        }

        if (id === "text") {
            let newFontSize = 0
            if (input.id === "textFit") {
                // change font size to more clearly indicate what the different text fit does
                if (input.value !== "growToFit" && Number(styles["font-size"]) < 200) {
                    newFontSize = 0
                } else {
                    newFontSize = input.value !== "growToFit" ? 100 : MAX_FONT_SIZE
                }
            } else if (input.id === "auto" && item?.textFit === "growToFit") {
                if (input.value && Number(styles["font-size"]) < MAX_FONT_SIZE) newFontSize = MAX_FONT_SIZE
                else if (!input.value && Number(styles["font-size"]) === MAX_FONT_SIZE) newFontSize = 100
            }
            if (newFontSize) updateValue({ detail: { name: "font_size", id: "style", key: "font-size", value: newFontSize + "px" } }, forced)
        }

        // SCOPE

        if (activeScope === "all") {
            const writes = getAllSlidesTargets(allItems).map(({ slide, items }) => ({ id: "setItems", slide, items, style: { key: targetId, values: [value] } }))
            if (writes.length) history({ id: "textScope", newData: { writes }, location: { page: "edit", show: $activeShow! } })
            return
        }

        if (activeScope === "template") {
            writeToTemplate(allItems, forced, (templateItem) => {
                if (!targetId.includes(".")) {
                    templateItem[targetId] = value
                    return
                }

                const splitted = targetId.split(".")
                const nested = typeof templateItem[splitted[0]] === "object" && templateItem[splitted[0]] !== null ? templateItem[splitted[0]] : {}
                nested[splitted[1]] = input.value
                templateItem[splitted[0]] = nested
            })
            return
        }

        // UPDATE

        if ($activeEdit.id) {
            if ($activeEdit.type === "overlay") overlays.update(updateItemValues)
            else if ($activeEdit.type === "template") templates.update(updateItemValues)

            return
        }

        history({
            id: "setItems",
            newData: { style: { key: targetId, values: [value] } },
            location: { page: "edit", show: $activeShow!, slide: getLayoutRef()[$activeEdit.slide!]?.id, items: allItems }
        })

        // update values
        // box2 = box2

        return

        function updateItemValues(a: any) {
            if (!a[$activeEdit.id!]?.items) return a

            allItems.forEach((i: number) => {
                if (!a[$activeEdit.id!].items[i]) return

                if (!targetId.includes(".")) {
                    a[$activeEdit.id!].items[i][targetId] = value
                    return
                }

                let splitted = targetId.split(".")
                let nested = a[$activeEdit.id!].items[i][splitted[0]]
                if (typeof nested !== "object" || nested === null) {
                    a[$activeEdit.id!].items[i][splitted[0]] = {}
                }
                a[$activeEdit.id!].items[i][splitted[0]][splitted[1]] = value
            })

            a[$activeEdit.id!].modified = Date.now()
            return a
        }
    }

    function isPartialTextSelection() {
        if (!selection?.length || !selection.some((a) => a?.start !== undefined && a.start !== a.end)) return false
        if (!item?.lines?.length) return false
        return !item.lines.every((line, i) => selection![i]?.start === 0 && selection![i]?.end === getLineText(line).length)
    }

    function disableAutoSize(items: number[]) {
        if ($activeEdit.id) {
            if ($activeEdit.type === "overlay") overlays.update(updateAutoSize)
            else if ($activeEdit.type === "template") templates.update(updateAutoSize)
            return
        }

        const location = { page: "edit" as const, show: $activeShow!, slide: getLayoutRef()[$activeEdit.slide!]?.id, items }
        // separate location ids so the different keys don't get coalesced into one history entry
        history({ id: "setItems", newData: { style: { key: "textFit", values: ["none"] } }, location: { ...location, id: "textFit" } })
        history({ id: "setItems", newData: { style: { key: "auto", values: [false] } }, location: { ...location, id: "auto" } })

        function updateAutoSize(a: any) {
            if (!a[$activeEdit.id!]?.items) return a
            items.forEach((i) => {
                if (!a[$activeEdit.id!].items[i]) return
                a[$activeEdit.id!].items[i].textFit = "none"
                a[$activeEdit.id!].items[i].auto = false
            })
            a[$activeEdit.id!].modified = Date.now()
            return a
        }
    }

    function updateValue(e: any, forced: ForcedScope | null = null) {
        let input = e.detail
        const activeScope = getActiveScope(forced)
        const activeSlideId: string = getLayoutRef()[$activeEdit.slide ?? ""]?.id
        console.log("BOX INPUT:", input)

        const sel = window.getSelection()
        const anchorNode = sel?.anchorNode
        const cellEditElem = anchorNode && (anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : anchorNode.parentElement)?.closest(".cell-content.edit")
        const td = cellEditElem?.closest("td")
        const rowIdx = td ? parseInt(td.getAttribute("data-row") || "") : -1
        const colIdx = td ? parseInt(td.getAttribute("data-col") || "") : -1

        if (item?.type === "table" && rowIdx >= 0 && colIdx >= 0 && input.key && item.table?.rows?.[rowIdx]?.cells?.[colIdx]) {
            let allItems: number[] = [...$activeEdit.items]
            if (!allItems.length) allSlideItems.forEach((_item, i) => allItems.push(i))
            let cellStyle = item.table.rows[rowIdx].cells[colIdx].style || ""
            cellStyle = addStyleString(cellStyle, [input.key, input.value])
            item.table.rows[rowIdx].cells[colIdx].style = cellStyle
            setValue({ id: "table", value: item.table }, allItems)
            return
        }

        let allItems: number[] = [...$activeEdit.items]
        // update all items if nothing is selected
        if (!allItems.length) allSlideItems.forEach((_item, i) => allItems.push(i))
        allSlideItems = clone(allSlideItems)

        // reverse to get same order as "Textbox" & "Items" etc., uses
        if (($activeEdit.type || "show") === "show") allItems = allItems.reverse()

        // only same type
        let currentType = id || allSlideItems[allItems[0]]?.type || "text"
        allItems = allItems.filter((index) => (allSlideItems[index]?.type || "text") === currentType)

        // font size on a partial selection is invisible while auto size is enabled, so disable auto size first
        if (id === "text" && input.id === "style" && input.key === "font-size" && input.name !== "font_size" && (item?.auto || (item?.textFit || "none") !== "none") && isPartialTextSelection()) {
            disableAutoSize(allItems)
            newToast("toast.autosize_disabled")
        }

        if (input.id === "nowrap") input = { ...input, id: "style", key: "white-space", value: input.value ? "nowrap" : undefined }

        if (input.id !== "style" && !input.id.includes("CSS")) {
            setValue(input, allItems, forced)
            return
        }

        let aligns: boolean = input.key === "align-items" || input.key === "text-align"

        if (input.id.includes("CSS")) allItems = [allItems[0]]

        // write the change into the template the slide uses
        if (activeScope === "template") {
            writeToTemplate(allItems, forced, (templateItem) => {
                const value = computeItemValue(input, templateItem, null, aligns)
                if (input.key === "align-items") templateItem.align = value
                else if (currentType !== "text" || (!templateItem.lines && typeof value === "string")) templateItem.style = value
                else
                    templateItem.lines?.forEach((line, j) => {
                        if (value?.[j] !== undefined) line[aligns ? "align" : "text"] = value[j]
                    })
            })
            return
        }

        /////

        // this is only for show slides
        let ref = getLayoutRef()
        let slides: string[] = [ref[$activeEdit.slide ?? ""]?.id || "other"]
        let slideItems: number[][] = [allItems]
        let showSlides = $showsCache[$activeShow?.id || ""]?.slides || {}

        if (activeScope === "all") {
            // every slide in the layout, matched by text box position
            const targets = getAllSlidesTargets(allItems)
            slides = targets.map((a) => a.slide)
            slideItems = targets.map((a) => a.items)
        } else if (slides[0] && $selected.id === "slide" && Array.isArray($selected.data)) {
            // get all selected slides
            let selectedSlides = $selected.data.filter(({ index }) => index !== $activeEdit.slide!)
            slides.push(...selectedSlides.map(({ index }) => ref[index]?.id))

            slides.forEach((id, i) => {
                if (!id || i === 0) return
                if (!showSlides[id]) {
                    slideItems.push([])
                    return
                }

                let currentItems = showSlides[id].items
                let currentItemIndexes = currentItems.map((_item, i) => i)

                // only same type
                currentItemIndexes = currentItemIndexes.filter((index) => (currentItems[index].type || "text") === currentType)
                slideItems.push(currentItemIndexes)
            })
        }

        /////

        // WIP get relative value
        // ItemStyle.svelte

        let values: { [key: string]: any[] } = {}
        slides.forEach((slide, i) => {
            if (!slideItems[i]?.length) return
            values[slide] = []
            slideItems[i].forEach((i) => getNewItemValues(clone(showSlides[slide]?.items?.[i] || allSlideItems[i]), slide))
        })

        function getNewItemValues(currentSlideItem: Item, slideId: string) {
            if (!currentSlideItem) return

            // a partial selection only makes sense on the slide it was made on
            const ranges = activeScope === "all" && slideId !== activeSlideId ? null : selection
            values[slideId].push(computeItemValue(input, currentSlideItem, ranges, aligns))
        }

        // align other items (VARIABLE)
        if (aligns && item?.type && item.type !== "text") {
            input.id = "align"
            setValue(input, allItems, forced)

            return
        }

        // TODO: remove unused (if default)

        if (!Object.values(values).length) return

        // update layout
        if ($activeEdit.id) {
            // overlay / template
            const sourceItems = ($activeEdit.type === "overlay" ? $overlays[$activeEdit.id]?.items : $templates[$activeEdit.id]?.items) || []
            // pair each selected item with its own computed value (data & indexes must stay aligned)
            let currentItems: Item[] = allItems.map((itemIndex) => clone(sourceItems[itemIndex]))
            const allValues: any[] = Object.values(values)[0] || []

            allItems.forEach((_itemIndex, i) => {
                if (!currentItems[i]) return

                let currentValue: any = allValues[i] ?? allValues[0]
                if (currentValue === undefined) return

                if (input.key === "align-items") currentItems[i].align = currentValue
                else if (currentType !== "text" || (!currentItems[i].lines && typeof currentValue === "string")) currentItems[i].style = currentValue
                else {
                    let lines = currentItems[i].lines
                    lines?.forEach((_a, j) => {
                        if (currentItems[i].lines?.[j] && currentValue?.[j] !== undefined) {
                            currentItems[i].lines![j][aligns ? "align" : "text"] = currentValue[j]
                        }
                    })
                }
            })

            // no text
            const textItems = currentItems.filter((a) => a?.lines)
            if (textItems.length) {
                let textLength = textItems.reduce((length, item) => (length += getItemText(item).length), 0)
                if (!textLength) {
                    newToast("empty.text")
                    return
                }
            }

            let override = $activeEdit.id + "#" + allItems.join(",")
            history({
                id: "UPDATE",
                oldData: { id: $activeEdit.id },
                newData: { key: "items", data: currentItems, indexes: allItems },
                location: { page: "edit", id: $activeEdit.type + "_items", override }
            })

            return
        }

        // one write per slide: "All slides" stores them as a single history entry
        let writes: { id: string; slide: string; items: number[]; style: any; override: string }[] = []
        if (setItemStyle.includes(id)) {
            slides.forEach((slide, i) => {
                if (!slideItems[i].length) return
                writes.push({ id: "setItems", slide, items: slideItems[i], style: { key: "style", values: values[slide] }, override: "slide_" + slide + "_items_" + slideItems[i].join(",") })
            })
        } else {
            let key: string = input.key === "text-align" || aligns ? "align" : "text"
            slides.forEach((slide, i) => {
                if (!slideItems[i].length) return
                // WIP
                const historyId = input.key === "text-align" ? "textAlign" : aligns ? "setItems" : "textStyle"
                writes.push({ id: historyId, slide, items: slideItems[i], style: { key, values: values[slide] }, override: "slide_" + slide + "_items_" + slideItems[i].join(",") })
            })
        }

        if (activeScope === "all") {
            if (writes.length) history({ id: "textScope", newData: { writes: writes.map(({ override: _override, ...write }) => write) }, location: { page: "edit", show: $activeShow! } })
            return
        }

        writes.forEach((write) => {
            history({
                id: write.id as any,
                newData: { style: write.style },
                location: { page: "edit", show: $activeShow!, slide: write.slide, items: write.items, override: write.override }
            })
        })
    }

    // TEXT SCOPE

    type ForcedScope = { scope: TextScope; templateId?: string }

    let scope: TextScope = "slide"
    $: scopeAvailable = id === "text" && !$activeEdit.id && ($activeEdit.type || "show") === "show" && !!$activeShow?.id
    const getActiveScope = (forced: ForcedScope | null): TextScope => (!scopeAvailable ? "slide" : forced?.scope || scope)

    $: myShow = showEntry($activeShow?.id || "")
    $: layoutSlideIds = scopeAvailable ? getLayoutSlideIds($myShow) : []
    $: activeLayoutSlideId = $activeEdit.slide !== null && $activeEdit.slide !== undefined ? getLayoutRef()[$activeEdit.slide]?.id || "" : ""

    function getLayoutSlideIds(_updater: Show | null) {
        return [...new Set<string>(getLayoutRef().map((a) => a.id))].filter(Boolean)
    }

    // same precedence as the edit header and the template apply: slide > group > first slide > category > show
    function getSlideTemplateId(slideId: string, show: Show | null, _deps: any[] = []): string {
        if (!show || !slideId) return ""

        const ref = getLayoutRef()
        const parentId = ref.find((a) => a.id === slideId)?.parent?.id || slideId
        const showTemplateId = show.settings?.template || ""
        return (
            resolveTemplateInUse({
                showTemplateId,
                categoryTemplateId: $categories[show.category || ""]?.template,
                firstSlideTemplateId: $templates[showTemplateId]?.settings?.firstSlideTemplate,
                slide: { isFirstSlide: ref[0]?.id === slideId, slideTemplateId: show.slides?.[slideId]?.settings?.template, groupTemplateId: $groups[show.slides?.[parentId]?.globalGroup || ""]?.template },
                isKnownTemplate: (templateId) => !!$templates[templateId]
            }).templateId || ""
        )
    }

    $: slideTemplateId = scopeAvailable ? getSlideTemplateId(activeLayoutSlideId, $myShow, [$templates, $groups, $categories]) : ""
    $: slideTemplateName = slideTemplateId ? $templates[slideTemplateId]?.name || translateText("main.unnamed") : ""
    $: if (scope === "template" && !slideTemplateName) scope = "slide"

    function getAllSlidesTargets(allItems: number[]) {
        const showId = $activeShow?.id || ""
        const showSlides = $showsCache[showId]?.slides || {}
        const activeSlideId = getLayoutRef()[$activeEdit.slide ?? ""]?.id
        const targets: { slide: string; items: number[] }[] = []

        getLayoutSlideIds(null).forEach((slideId) => {
            if (!showSlides[slideId]) return
            if (slideId !== activeSlideId && isSlideLocked(showId, slideId)) return

            const items = slideId === activeSlideId ? allItems : matchItemIndexes(allSlideItems, allItems, showSlides[slideId].items || []).map((a) => a.target)
            if (!items.length) return
            // the edited slide always goes first
            if (slideId === activeSlideId) targets.unshift({ slide: slideId, items })
            else targets.push({ slide: slideId, items })
        })

        return targets
    }

    // template items matching the edited items, changed by `change`, written through the template update path (history, so undo works)
    function writeToTemplate(allItems: number[], forced: ForcedScope | null, change: (_item: Item) => void) {
        const templateId = forced?.templateId || slideTemplateId
        const templateItems: Item[] = $templates[templateId]?.items || []
        const pairs = matchItemIndexes(allSlideItems, allItems, templateItems)
        if (!templateId || !pairs.length) {
            newToast("text_scope.no_match")
            return
        }

        const indexes = pairs.map((a) => a.target)
        const changed = indexes.map((index) => {
            const templateItem = clone(templateItems[index])
            change(templateItem)
            return templateItem
        })

        history({
            id: "UPDATE",
            oldData: { id: templateId },
            newData: { key: "items", data: changed, indexes },
            location: { page: "edit", id: "template_items", override: templateId + "#" + indexes.join(",") }
        })
    }

    // the new value of one item for a style input (selection ranges: null changes the whole item)
    function computeItemValue(input: any, currentSlideItem: Item, ranges: { start: number; end: number }[] | null, aligns: boolean) {
        let selected = ranges
        if (!selected?.length || !selected?.filter((a) => a.start !== a.end).length) {
            selected = []
            currentSlideItem.lines?.forEach((line) => {
                selected!.push({ start: 0, end: getLineText(line).length })
            })
        }

        if (input.key === "text-align") {
            let newAligns: any[] = []
            currentSlideItem.lines?.forEach((line, linePos) => {
                if (!ranges?.length || ranges[linePos]?.start !== undefined) newAligns.push(`${input.key}: ${input.value};`)
                else newAligns.push(line.align)
            })
            return newAligns
        }

        if (currentSlideItem.lines) {
            if (input.id.includes("CSS")) return addStyle(selected, currentSlideItem, input.value).lines!.map((a) => a.text)
            return aligns ? addStyleString(currentSlideItem.align || "", [input.key, input.value]) : addStyle(selected, clone(currentSlideItem), [input.key, input.value]).lines!.map((a) => a.text)
        }

        if (input.id.includes("CSS")) return input.value
        // merge into each item's own style so position etc. is kept when changing multiple items
        return addStyleString(currentSlideItem.style || "", [input.key, input.value])
    }

    // offer after a change to one slide: apply it to all slides, save it to the template, or keep it as is
    let lastChange: { input: any; templateId: string; slideId: string } | null = null
    $: offerVisible = !!lastChange && lastChange.slideId === activeLayoutSlideId && scope === "slide"

    function offerAction(e: CustomEvent<string>) {
        const change = lastChange
        if (!change) return
        if (e.detail === "all") updateValue({ detail: clone(change.input) }, { scope: "all" })
        else if (e.detail === "template") {
            updateValue({ detail: clone(change.input) }, { scope: "template", templateId: change.templateId })
            newToast(translateText("text_scope.template_saved", null, [$templates[change.templateId]?.name || ""]))
        }
        lastChange = null
    }

    // slides with text styling of their own, compared to the template each slide uses
    $: ownStyleSlideIds = scopeAvailable ? getOwnStyleSlideIds($myShow, [$templates, $groups, $categories]) : []
    $: showFooter = scopeAvailable && layoutSlideIds.some((slideId) => !!getSlideTemplateId(slideId, $myShow, [$templates, $groups, $categories]))

    function getOwnStyleSlideIds(show: Show | null, _deps: any[]) {
        if (!show) return []
        const slides = getLayoutSlideIds(show)
            .filter((slideId) => show.slides?.[slideId] && !isSlideLocked($activeShow?.id || "", slideId))
            .map((slideId) => ({ id: slideId, items: show.slides[slideId].items || [] }))
        return getOwnTextStyleSlideIds(slides, (slideId) => $templates[getSlideTemplateId(slideId, show)]?.items)
    }

    function resetOwnStyle() {
        const show = $myShow
        if (!show || !ownStyleSlideIds.length) return

        const items: { [slideId: string]: Item[] } = {}
        ownStyleSlideIds.forEach((slideId) => {
            const templateItems = $templates[getSlideTemplateId(slideId, show)]?.items
            if (templateItems) items[slideId] = resetTextStyleToTemplate(show.slides[slideId].items || [], templateItems)
        })

        // one history step, and the slides stay as they are linked to their templates
        if (Object.keys(items).length) history({ id: "textScope", newData: { items, detach: false }, location: { page: "edit", show: $activeShow! } })
    }

    $: boxSections = box?.sections || {}
    function updateValue2(e: any) {
        const input = e.detail
        input.value = input.values.value
        input.input = input.type

        if (input.id === "textFit") updateValue({ detail: { id: "auto", value: input.value !== "none" } })
        // unset transparent color
        if (input.key === "text-shadow" && input.value.includes("rgb(0 0 0 / 0)") && input.value.includes("px")) {
            input.value = input.value.replace("rgb(0 0 0 / 0)", "rgb(0 0 0 / 0.4)")
        }

        // store changes for detection
        if (!$activeEdit.id) {
            const id = `${input.id}${input.key || ""}`
            if (!changes[$activeEdit.slide || 0]) changes[$activeEdit.slide || 0] = {}
            changes[$activeEdit.slide || 0][id] = JSON.stringify(input)
            changes = changes
        }

        // remember the template before the change: a manual change on a slide removes its show template
        const offerTemplateId = slideTemplateId
        const offerSlideId = activeLayoutSlideId
        const offerInput = clone(input)

        updateValue({ detail: input })

        if (scopeAvailable && scope === "slide" && offerSlideId) lastChange = { input: offerInput, templateId: offerTemplateId, slideId: offerSlideId }
    }

    // don't load right away (because that will load content twice)
    let loaded = false
    let hasLoaded = false
    onMount(() => {
        loaded = true
        setTimeout(() => (hasLoaded = true), 100)
    })

    // check if the same changes are made to multiple slides, and notify the user to consider using templates
    let changes: { [key: string]: { [key: string]: string } } = {}
    $: if (changes) checkChanges()
    let shownTemplateTip = false
    function checkChanges() {
        // alert if category has template
        if (hasLoaded && !shownTemplateTip && ($activeEdit.type || "show") === "show") {
            const categoryId = $showsCache[$activeShow?.id || ""]?.category || ""
            const categoryTemplate = $categories[categoryId]?.template || ""
            if (categoryTemplate) {
                alertMessage.set("tips.category_template")
                activePopup.set("alert")
                shownTemplateTip = true
                return
            }
        }

        // alert if all outputs has style templates
        if (hasLoaded && !shownTemplateTip && $special.styleTemplatePreview !== false) {
            const outputsHasStyleTemplate = getAllEnabledOutputs().every((output) => {
                return !!$outputStyles[output?.style || ""]?.template
            })
            if (outputsHasStyleTemplate) {
                alertMessage.set("tips.style_template_active")
                activePopup.set("alert")
                shownTemplateTip = true
                return
            }
        }

        if ($shownTips.includes("consider_templates")) return

        // the apply offer in the text tools already suggests this, so don't interrupt with a popup
        if (scopeAvailable) return

        const SLIDES = 3
        const allValues: string[] = Object.values(changes).flatMap((slide) => Object.values(slide))
        const valueCounts = new Map<string, number>()

        allValues.forEach((value) => {
            valueCounts.set(value, (valueCounts.get(value) || 0) + 1)
        })

        const duplicates = Array.from(valueCounts.entries()).filter(([_value, count]) => count > SLIDES)
        if (duplicates.length > 0) {
            // openDrawer("templates")
            alertMessage.set("tips.consider_templates")
            activePopup.set("alert")
            shownTips.set([...$shownTips, "consider_templates"])
        }
    }
</script>

<svelte:window on:keyup={keyup} on:keydown={keydown} on:mouseup={getTextSelection} on:mousedown={mousedown} />

{#if loaded}
    {#if scopeAvailable}
        <TextScopeControl {scope} templateName={slideTemplateName} offer={offerVisible} offerHasTemplate={!!lastChange?.templateId} offerHasOtherSlides={layoutSlideIds.length > 1} on:scope={(e) => (scope = e.detail)} on:offer={offerAction} />
    {/if}
    <EditValues sections={boxSections} {item} {styles} {customValues} type="text" on:change={updateValue2} />
    {#if showFooter}
        <TextScopeFooter count={ownStyleSlideIds.length} on:reset={resetOwnStyle} />
    {/if}
{/if}
