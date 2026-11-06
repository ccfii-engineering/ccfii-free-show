// Store-free helpers shared by the template merge module and the original helper files
// (array.ts, media.ts, edit/scripts/textStyle.ts re-export them). Do not import stores or other
// app modules here: this file must stay loadable without the store graph.

import type { Item } from "../../../types/Show"

// clone objects
export function clone<T>(object: T): T {
    if (object === null || typeof object !== "object") return object

    try {
        return structuredClone(object)
    } catch {
        try {
            return JSON.parse(JSON.stringify(object))
        } catch {
            return object
        }
    }
}

// compare two objects, check that they are identical, regardless of key order
export function areObjectsEqual(a: Record<string, any>, b: Record<string, any>): boolean {
    return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
}

// get text of item.text...
export function getItemText(item: Item | null): string {
    let text = ""

    const lines = item?.lines
    if (Array.isArray(lines)) {
        for (const line of lines) {
            const textArr = line.text
            if (Array.isArray(textArr)) {
                for (const t of textArr) {
                    if (t.value) text += t.value
                }
            }
        }
    }

    return text
}

export function removeExtension(name: string): string {
    if (typeof name !== "string" || !name) return ""
    if (name.indexOf(".") < 0) return name
    return name.slice(0, name.lastIndexOf("."))
}

export function getFileName(path: string): string {
    if (typeof path !== "string") return ""
    if (path.indexOf("\\") > -1) return path.substring(path.lastIndexOf("\\") + 1)
    if (path.indexOf("/") > -1) return path.substring(path.lastIndexOf("/") + 1)
    return path
}
