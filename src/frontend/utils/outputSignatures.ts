const jsonSignatureCache = new WeakMap<object, string>()

export function getJsonSignature(value: any): string {
    if (value === null) return "null"
    if (value === undefined) return "undefined"
    if (typeof value !== "object") return JSON.stringify(value)

    const cached = jsonSignatureCache.get(value)
    if (cached !== undefined) return cached

    const signature = JSON.stringify(value)
    jsonSignatureCache.set(value, signature)
    return signature
}

export function getIdArraySignature(values: any[] | null | undefined): string {
    if (!Array.isArray(values) || !values.length) return ""
    return values.map((value) => (typeof value === "string" || typeof value === "number" ? String(value) : getJsonSignature(value))).join("\u001f")
}

export function getSelectedEntriesSignature(map: Record<string, any> | null | undefined, ids: string[] | null | undefined): string {
    if (!map || !Array.isArray(ids) || !ids.length) return ""
    return ids.map((id) => `${id}:${getJsonSignature(map[id] ?? null)}`).join("\u001e")
}

export function getCurrentLineSignature(lines: Record<string, any> | null | undefined, lineId: string | undefined): string {
    if (!lineId) return "null"
    return getJsonSignature(lines?.[lineId] ?? null)
}

export function getCurrentLineMap(lines: Record<string, any> | null | undefined, lineId: string | undefined): Record<string, any> {
    if (!lineId) return {}
    return { [lineId]: lines?.[lineId] ?? null }
}

export function getOutSlideSignature(outSlide: Record<string, any> | null | undefined): string {
    if (!outSlide) return "null"

    const { line: _line, revealCount: _revealCount, itemClickReveal: _itemClickReveal, ...rest } = outSlide
    return getJsonSignature(rest)
}

export function getOutputReceiverSignature(outputs: Record<string, any> | null | undefined, id: string): string {
    const entry = outputs?.[id]
    if (!entry) return "missing"

    const { active: _active, ...rest } = entry
    return getJsonSignature(rest)
}
