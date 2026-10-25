export type PowerPointRenderBounds = { maxWidth: number; maxHeight: number; maxPixels: number }

export type PowerPointRendererRequest =
    | { operation: "OPEN"; requestId: string; jobToken: string; bytes: Uint8Array }
    | { operation: "PAGE"; requestId: string; jobToken: string; pageIndex: number; bounds: PowerPointRenderBounds }
    | { operation: "CLOSE"; requestId: string; jobToken: string }

export type PowerPointRendererResult =
    | { pageCount: number; rendererVersion: string }
    | { pageIndex: number; png: ArrayBuffer; width: number; height: number }
    | { closed: true }

export type PowerPointRendererReply = {
    operation: PowerPointRendererRequest["operation"]
    requestId: string
    jobToken: string
    result?: PowerPointRendererResult
    error?: string
}
