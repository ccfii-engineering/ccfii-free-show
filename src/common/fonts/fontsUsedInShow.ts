// Collects the font families used by a show's item styles and text-run styles.
// Styles are CSS strings, e.g. "top:0;font-family:'CMGSans', sans-serif;" (see addStyleString in textStyle.ts).

import type { Show } from "../../types/Show"
import { normalizeFontName } from "./orderFontsForShow"

const FAMILY_REGEX = /(?:^|;)\s*font-family\s*:\s*([^;]*)/gi

function familiesInStyle(style: unknown): string[] {
    if (typeof style !== "string" || !style) return []

    const families: string[] = []
    for (const match of style.matchAll(FAMILY_REGEX)) {
        // first family of a fallback list, which may be quoted
        const first = match[1].trim().match(/^(?:'[^']*'|"[^"]*"|[^,]*)/)?.[0] || ""
        const name = normalizeFontName(first)
        if (name) families.push(name)
    }
    return families
}

export function collectFontsUsedInShow(show: Show | null | undefined): string[] {
    const fonts: string[] = []
    const seen = new Set<string>()
    const add = (style: unknown) => {
        for (const name of familiesInStyle(style)) {
            if (seen.has(name.toLowerCase())) continue
            seen.add(name.toLowerCase())
            fonts.push(name)
        }
    }

    for (const slide of Object.values(show?.slides || {})) {
        for (const item of slide?.items || []) {
            add(item?.style)
            for (const line of item?.lines || []) {
                for (const run of line?.text || []) add(run?.style)
            }
        }
    }

    return fonts
}
