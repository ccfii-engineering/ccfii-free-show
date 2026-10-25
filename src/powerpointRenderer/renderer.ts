import { parse, slideToPng, type Presentation } from "@web-ppt/core"
import type { PowerPointRendererRequest, PowerPointRendererResult } from "../types/PowerPointRenderer"

const RENDERER_VERSION = "@web-ppt/core 0.4.5"
let presentation: Presentation | undefined

function closePresentation() {
    presentation?.dispose?.()
    presentation = undefined
}

function scaleForPresentation(pres: Presentation, bounds: { maxWidth: number; maxHeight: number; maxPixels: number }) {
    if (!Number.isFinite(pres.width) || !Number.isFinite(pres.height) || pres.width < 1 || pres.height < 1) throw new Error("The .pptx slide has invalid dimensions")
    const originalPixels = pres.width * pres.height
    if (!Number.isFinite(originalPixels) || originalPixels < 1) throw new Error("The .pptx slide is too large to render safely")
    return Math.min(bounds.maxWidth / pres.width, bounds.maxHeight / pres.height, Math.sqrt(bounds.maxPixels / originalPixels))
}

async function renderRequest(request: PowerPointRendererRequest): Promise<PowerPointRendererResult> {
    if (request.operation === "OPEN") {
        closePresentation()
        presentation = await parse(request.bytes)
        if (presentation.slides.length < 1) throw new Error("This .pptx file does not contain any slides")
        return { pageCount: presentation.slides.length, rendererVersion: RENDERER_VERSION }
    }

    if (request.operation === "PAGE") {
        if (!presentation) throw new Error("The .pptx file has not been opened")
        if (request.pageIndex >= presentation.slides.length) throw new Error("The requested slide does not exist")
        const slide = presentation.slides[request.pageIndex]
        const blob = await slideToPng(presentation, slide, scaleForPresentation(presentation, request.bounds))
        if (blob.type !== "image/png" || blob.size < 1 || blob.size > 16 * 1024 * 1024) throw new Error("The slide produced an invalid or oversized PNG")
        const bitmap = await createImageBitmap(blob)
        const width = bitmap.width
        const height = bitmap.height
        bitmap.close()
        return { pageIndex: request.pageIndex, png: await blob.arrayBuffer(), width, height }
    }

    closePresentation()
    return { closed: true }
}

window.powerPointRenderer.onRequest(renderRequest)
