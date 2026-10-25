import type { PowerPointRendererRequest, PowerPointRendererResult } from "../types/PowerPointRenderer"

declare global {
    interface Window {
        powerPointRenderer: {
            onRequest: (callback: (request: PowerPointRendererRequest) => Promise<PowerPointRendererResult> | PowerPointRendererResult) => boolean
        }
    }
}

export {}
