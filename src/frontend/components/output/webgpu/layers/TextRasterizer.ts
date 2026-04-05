import { Texture } from "pixi.js"
import { toCanvas } from "html-to-image"

let rasterizeQueue: Promise<void> = Promise.resolve()

export async function rasterizeElement(element: HTMLElement, width: number, height: number): Promise<HTMLCanvasElement | null> {
    if (!element || width <= 0 || height <= 0) return null

    try {
        const canvas = await toCanvas(element, {
            width,
            height,
            pixelRatio: window.devicePixelRatio || 1,
            skipAutoScale: true,
            cacheBust: false,
            includeQueryParams: false
        })
        return canvas
    } catch (error) {
        console.warn("TextRasterizer: rasterization failed:", error)
        return null
    }
}

export async function rasterizeToTexture(element: HTMLElement, width: number, height: number): Promise<Texture> {
    const canvas = await rasterizeElement(element, width, height)
    if (!canvas) return Texture.EMPTY

    try {
        return Texture.from(canvas)
    } catch {
        return Texture.EMPTY
    }
}

// Queued rasterization to prevent overlapping captures
export function queueRasterize(
    element: HTMLElement,
    width: number,
    height: number,
    onComplete: (texture: Texture) => void
): void {
    rasterizeQueue = rasterizeQueue.then(async () => {
        // Small delay to let DOM settle after reactive updates
        await new Promise((resolve) => setTimeout(resolve, 16))

        const texture = await rasterizeToTexture(element, width, height)
        onComplete(texture)
    }).catch(() => {})
}
