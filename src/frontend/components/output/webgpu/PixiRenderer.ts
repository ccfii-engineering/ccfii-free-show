import { Application, Container } from "pixi.js"
import type { PixiOutputConfig } from "../../../../types/WebGPU"

export interface StageContainers {
    background: Container
    underlays: Container
    effectsUnder: Container
    slide: Container
    effectsOver: Container
    overlays: Container
    draw: Container
}

export function createDefaultConfig(width: number, height: number, transparent: boolean): PixiOutputConfig {
    return {
        width: width || 1920,
        height: height || 1080,
        backgroundColor: transparent ? "transparent" : "#000000",
        transparent,
        preference: "webgpu"
    }
}

export async function initPixiApp(canvas: HTMLCanvasElement, config: PixiOutputConfig): Promise<Application> {
    const app = new Application()

    try {
        await app.init({
            canvas,
            width: config.width,
            height: config.height,
            backgroundColor: 0x000000,
            backgroundAlpha: config.transparent ? 0 : 1,
            preference: config.preference,
            antialias: true,
            resolution: 1
        })
        console.log("PixiJS initialized:", app.renderer.type === 0x02 ? "WebGPU" : "WebGL", `${config.width}x${config.height}`)
    } catch (e) {
        console.warn("PixiJS WebGPU init failed, falling back to WebGL:", e)
        await app.init({
            canvas,
            width: config.width,
            height: config.height,
            backgroundColor: 0x000000,
            backgroundAlpha: config.transparent ? 0 : 1,
            preference: "webgl",
            antialias: true,
            resolution: 1
        })
        console.log("PixiJS initialized (WebGL fallback):", `${config.width}x${config.height}`)
    }

    return app
}

export function createStageContainers(app: Application): StageContainers {
    const background = new Container()
    const underlays = new Container()
    const effectsUnder = new Container()
    const slide = new Container()
    const effectsOver = new Container()
    const overlays = new Container()
    const draw = new Container()

    background.label = "background"
    underlays.label = "underlays"
    effectsUnder.label = "effectsUnder"
    slide.label = "slide"
    effectsOver.label = "effectsOver"
    overlays.label = "overlays"
    draw.label = "draw"

    app.stage.addChild(background)
    app.stage.addChild(underlays)
    app.stage.addChild(effectsUnder)
    app.stage.addChild(slide)
    app.stage.addChild(effectsOver)
    app.stage.addChild(overlays)
    app.stage.addChild(draw)

    return { background, underlays, effectsUnder, slide, effectsOver, overlays, draw }
}

export function resizeApp(app: Application, width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    app.renderer.resize(width, height)
}

export function destroyApp(app: Application): void {
    app.destroy(true, { children: true, texture: true })
}
