import type { Output, OutData } from "../../../types/Output"
import type { OutputPresentationMode } from "../../../types/OutputState"

export function clearPresentation(output: Output): Output {
    return {
        ...output,
        out: {
            presentationMode: "cleared",
            background: null,
            slide: null,
            overlays: [],
            effects: [],
            transition: null
        }
    }
}

export function nextPresentationMode(current: OutputPresentationMode | undefined, type: string, data: unknown): OutputPresentationMode {
    if ((type === "slide" || type === "background") && data) return "live"
    return current ?? "live"
}

export function resolveVisibleBackgrounds<T>({ presentationMode, explicit, template, style }: { presentationMode: OutputPresentationMode | undefined; explicit: T | null; template: T | null; style: T | null }): { style: T | null; content: T | null } {
    if (presentationMode === "cleared") return { style: null, content: null }
    return { style, content: template || explicit }
}

export function isPresentationCleared(out: OutData | undefined): boolean {
    return out?.presentationMode === "cleared"
}
