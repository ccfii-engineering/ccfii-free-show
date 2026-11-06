// Pure lyrics text analysis shared by the desktop Text tab and the Remote app.
// No store access and no imports from src/frontend.
//
// The format rules mirror the Edit page Text tab parser in
// src/frontend/components/show/formatTextEditor.ts:
// - blank line ("\n\n") starts a new slide: `formatText`
// - a first line that is only `[Name]` and not a textbox marker is a group: `getSlide`
// - `[#1]`, `[#2:es]` start a textbox, optionally with a language: `linesToTextboxes`
// - `[C]` inside a line is a chord and is removed from the text, unless it is longer
//   than 12 characters or is the virtual break marker: `getChords`
// - the first slide without a group becomes "Verse": `groupSlides`

/** Lines longer than this (without chords and textbox markers) are flagged. */
export const DEFAULT_MAX_LINE_LENGTH = 45

const TEXTBOX_REGEX = /\[#(\d+)(?::([^\]]+))?\]/
const VIRTUAL_BREAK_CHAR = "[_VB]"
const MAX_CHORD_LENGTH = 12
const IMPLICIT_GROUP = "Verse"

export interface LyricsTextbox {
    /** Number from the `[#n]` marker, 0 when the slide has no markers. */
    index: number
    language: string
    lines: string[]
}

export interface LyricsSlide {
    /** 1-based position in the text. */
    index: number
    /** Group name, or null for a slide that continues the previous group. */
    group: string | null
    /** True when the slide starts with a `[Group]` line, false for the implicit leading Verse. */
    isExplicitGroup: boolean
    /** All lines without chords and markers, in text order. */
    lines: string[]
    textboxes: LyricsTextbox[]
}

export interface LyricsGroup {
    name: string
    slideCount: number
    /** 1-based number of the first slide in the group. */
    firstSlide: number
}

export interface LongLine {
    /** 1-based slide number. */
    slide: number
    /** 1-based line number inside the slide, group and marker lines excluded. */
    line: number
    length: number
    text: string
}

export interface LyricsAnalysis {
    slideCount: number
    slides: LyricsSlide[]
    groups: LyricsGroup[]
    longLines: LongLine[]
}

export interface AnalyzeLyricsOptions {
    /** Defaults to DEFAULT_MAX_LINE_LENGTH. Ignored when not a positive number. */
    maxLineLength?: number
}

/** Remove `[C]` style chords, keep long bracketed text and the virtual break marker. */
function stripChords(line: string): string {
    let text = ""
    let inChord = false
    let chord = ""

    for (const char of line) {
        if (char === "[") {
            inChord = true
            chord = ""
            continue
        }
        if (!inChord) {
            text += char
            continue
        }
        if (char === "]") {
            inChord = false
            if (chord.length > MAX_CHORD_LENGTH || `[${chord}]` === VIRTUAL_BREAK_CHAR) text += `[${chord}]`
            continue
        }
        chord += char
    }

    return text
}

function parseSlide(slideText: string, index: number): LyricsSlide {
    const slideLines = slideText.split("\n")
    let group: string | null = null
    let isExplicitGroup = false

    const firstLine = slideLines[0]
    const firstBracketEnd = firstLine.indexOf("]")
    if (!TEXTBOX_REGEX.test(firstLine) && firstLine.indexOf("[") === 0 && firstBracketEnd === firstLine.trim().length - 1) {
        group = firstLine.slice(1, firstBracketEnd)
        isExplicitGroup = true
        slideLines.shift()
    }

    const textboxes: LyricsTextbox[] = []
    const lines: string[] = []
    let current: LyricsTextbox | null = null

    const getTextbox = (number: number) => {
        let box = textboxes.find((item) => item.index === number)
        if (!box) {
            box = { index: number, language: "", lines: [] }
            textboxes.push(box)
        }
        return box
    }

    slideLines.forEach((rawLine) => {
        let line = rawLine
        const marker = line.match(TEXTBOX_REGEX)
        if (marker) {
            current = getTextbox(Number(marker[1]))
            if (marker[2]) current.language = marker[2]

            line = line.slice(line.indexOf("]") + 1).trim()
            if (!line.length) return
        }

        if (!current) current = getTextbox(0)
        const text = stripChords(line)
        current.lines.push(text)
        lines.push(text)
    })

    textboxes.sort((a, b) => a.index - b.index)

    return { index, group, isExplicitGroup, lines, textboxes }
}

export function analyzeLyricsText(text: string, options: AnalyzeLyricsOptions = {}): LyricsAnalysis {
    const limit = typeof options.maxLineLength === "number" && options.maxLineLength > 0 ? options.maxLineLength : DEFAULT_MAX_LINE_LENGTH

    if (!text || !text.trim()) return { slideCount: 0, slides: [], groups: [], longLines: [] }

    const slides = text
        .replaceAll("\r\n", "\n")
        .split("\n\n")
        .map((slideText, i) => parseSlide(slideText, i + 1))

    const groups: LyricsGroup[] = []
    const longLines: LongLine[] = []

    slides.forEach((slide, i) => {
        const name = slide.group ?? (i === 0 ? IMPLICIT_GROUP : null)
        if (name !== null) groups.push({ name, slideCount: 0, firstSlide: slide.index })
        groups[groups.length - 1].slideCount++

        slide.lines.forEach((line, lineIndex) => {
            if (line.length > limit) longLines.push({ slide: slide.index, line: lineIndex + 1, length: line.length, text: line })
        })
    })

    return { slideCount: slides.length, slides, groups, longLines }
}
