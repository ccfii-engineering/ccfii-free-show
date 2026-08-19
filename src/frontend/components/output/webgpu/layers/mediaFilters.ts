export type CSSMediaFilterOperation = {
    name: "brightness" | "contrast" | "saturate" | "grayscale" | "sepia" | "invert" | "hue-rotate" | "blur" | "opacity"
    value: number
}

const SUPPORTED_FILTERS = new Set<CSSMediaFilterOperation["name"]>(["brightness", "contrast", "saturate", "grayscale", "sepia", "invert", "hue-rotate", "blur", "opacity"])

export function parseCSSMediaFilters(value: string | null | undefined): CSSMediaFilterOperation[] {
    if (!value || value.trim() === "none") return []

    const operations: CSSMediaFilterOperation[] = []
    for (const match of value.matchAll(/([a-z-]+)\(\s*(-?[0-9]*\.?[0-9]+)(%|deg|px)?\s*\)/gi)) {
        const name = match[1].toLowerCase() as CSSMediaFilterOperation["name"]
        if (!SUPPORTED_FILTERS.has(name)) continue
        let numericValue = Number(match[2])
        if (!Number.isFinite(numericValue)) continue
        if (match[3] === "%") numericValue /= 100
        operations.push({ name, value: numericValue })
    }
    return operations
}
