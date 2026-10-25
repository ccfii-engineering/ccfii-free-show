import type { Item, Slide } from "../types/Show"

export type OutputLineWindow = { start: number | null; end: number | null }

export interface OutputLineWindowOptions {
    line: number
    maxLines: number
    styleLines: number
    amountOfLinesToShow: number
    highestLinePos: number
}

export function getOutputLineWindow({ line, maxLines, styleLines, amountOfLinesToShow, highestLinePos }: OutputLineWindowOptions): OutputLineWindow {
    if (!maxLines) return { start: null, end: null }

    let progress = (line + 1) / maxLines
    if (line + amountOfLinesToShow > maxLines) progress = 1

    const linesIndex = Math.ceil(maxLines * progress) - 1
    let start = styleLines ? styleLines * Math.floor(linesIndex / styleLines) : 0

    const isEnding = maxLines && highestLinePos + amountOfLinesToShow >= maxLines
    const overflow = styleLines ? maxLines % styleLines : 0
    if (isEnding && overflow > 0) start = maxLines - overflow

    return { start: styleLines ? start : null, end: styleLines ? start + styleLines : null }
}

export function getRevealLineWindow(revealCount: number, styleLines: number): OutputLineWindow {
    return { start: styleLines ? Math.max(0, revealCount - styleLines) : 0, end: revealCount }
}

export function getItemWithMostLines(slide: Slide | { items: Item[] }) {
    let amount = 0
    if (!Array.isArray(slide.items)) return amount
    slide.items.forEach((item) => {
        const lines = Array.isArray(item?.lines) ? item.lines.filter((line) => Array.isArray(line.text) && line.text.filter((text) => text.value !== undefined).length > 0).length : 0
        if (lines > amount) amount = lines
    })
    return amount
}
