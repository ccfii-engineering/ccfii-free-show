// Pure font picker ordering: fonts used in the show, then recently picked fonts, then the rest.
// Names are plain family names. Quotes (as stored in styles, e.g. 'CMGSans') are ignored.

export const MAX_RECENT_FONTS = 5

export type OrderedFonts = { used: string[]; recent: string[]; all: string[] }

export function normalizeFontName(name: string): string {
    return (name || "")
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2")
        .trim()
}

const keyOf = (name: string) => name.toLowerCase()

export function orderFontsForShow({ systemFonts, usedInShow, recent }: { systemFonts: string[]; usedInShow: string[]; recent: string[] }): OrderedFonts {
    const system = new Map<string, string>()
    for (const raw of systemFonts || []) {
        const name = normalizeFontName(raw)
        if (name && !system.has(keyOf(name))) system.set(keyOf(name), name)
    }

    const seen = new Set<string>()
    const pick = (list: string[], mustBeInstalled: boolean) => {
        const result: string[] = []
        for (const raw of list || []) {
            const name = normalizeFontName(raw)
            if (!name || seen.has(keyOf(name))) continue
            const installed = system.get(keyOf(name))
            if (!installed && mustBeInstalled) continue
            seen.add(keyOf(name))
            result.push(installed || name)
        }
        return result
    }

    // a used font stays visible even if it is not installed, so the show's current font is never hidden
    const used = pick(usedInShow, false)
    const recentFonts = pick(recent, true)
    const all = [...system.values()].filter((name) => !seen.has(keyOf(name)))

    return { used, recent: recentFonts, all }
}

// returns a new list with the picked font first, without duplicates, capped
export function addRecentFont(recent: string[], font: string, max = MAX_RECENT_FONTS): string[] {
    const name = normalizeFontName(font)
    const list = recent || []
    if (!name) return list
    return [name, ...list.filter((a) => keyOf(normalizeFontName(a)) !== keyOf(name))].slice(0, max)
}
