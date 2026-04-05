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
        width,
        height,
        backgroundColor: transparent ? "transparent" : "#000000",
        transparent,
        preference: "webgpu"
    }
}

export async function initPixiApp(canvas: HTMLCanvasElement, config: PixiOutputConfig): Promise<Application> {
    const app = new Application()
    await app.init({
        canvas,
        width: config.width,
        height: config.height,
        backgroundColor: config.transparent ? 0x000000 : config.backgroundColor,
        backgroundAlpha: config.transparent ? 0 : 1,
        preference: config.preference,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1
    })
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
