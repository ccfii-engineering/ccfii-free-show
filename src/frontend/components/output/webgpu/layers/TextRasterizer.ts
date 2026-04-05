import { toCanvas } from "html-to-image"

let rasterizeQueue: Promise<void> = Promise.resolve()
let pixiModule: any = null

async function getPixi() {
    if (!pixiModule) pixiModule = await import("pixi.js")
    return pixiModule
}

export async function rasterizeElement(element: HTMLElement, width: number, height: number): Promise<HTMLCanvasElement | null> {
    if (!element || width <= 0 || height <= 0) return null

    try {
        console.log("TextRasterizer: capturing element", element.tagName, width, "x", height, "innerHTML length:", element.innerHTML.length)
        const canvas = await toCanvas(element, {
            width,
            height,
            pixelRatio: 1,
            skipAutoScale: true,
            cacheBust: false
        })
        console.log("TextRasterizer: canvas created", canvas.width, "x", canvas.height)
        return canvas
    } catch (error) {
        console.warn("TextRasterizer: rasterization failed:", error)
        return null
    }
}

export async function rasterizeToTexture(element: HTMLElement, width: number, height: number): Promise<any> {
    const PIXI = await getPixi()
    const canvas = await rasterizeElement(element, width, height)
    if (!canvas) return PIXI.Texture.EMPTY

    try {
        return PIXI.Texture.from(canvas)
    } catch (e) {
        console.warn("TextRasterizer: texture creation failed:", e)
        return PIXI.Texture.EMPTY
    }
}

export function queueRasterize(
    element: HTMLElement,
    width: number,
    height: number,
    onComplete: (texture: any) => void
): void {
    rasterizeQueue = rasterizeQueue.then(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))

        const texture = await rasterizeToTexture(element, width, height)
        onComplete(texture)
    }).catch((e) => {
        console.warn("TextRasterizer: queue error:", e)
    })
}
