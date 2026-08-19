import { hasRequiredWebGPUPlatform, initializeGPUBackend, rendererTypeMatchesBackend, type GPUBackend } from "./GPUBackend"
import { presentProbeFrame } from "./PixiPresentationProbe"

interface PixiOutputSessionOptions {
    PIXI: any
    canvas: HTMLCanvasElement
    width: number
    height: number
    transparent: boolean
}

export interface PixiOutputSession {
    app: any
    backend: GPUBackend
    canvas: HTMLCanvasElement
}

export async function initializePixiOutputSession(options: PixiOutputSessionOptions): Promise<PixiOutputSession> {
    let activeCanvas = options.canvas
    let backendAttempt = 0
    const initialized = await initializeGPUBackend({
        create: async (backend) => {
            if (backend === "webgpu" && !hasRequiredWebGPUPlatform(globalThis)) throw new Error("Required WebGPU browser APIs are unavailable")
            if (backendAttempt++) {
                const replacement = activeCanvas.cloneNode(false) as HTMLCanvasElement
                activeCanvas.replaceWith(replacement)
                activeCanvas = replacement
            }
            const app = new options.PIXI.Application()
            try {
                await app.init({
                    canvas: activeCanvas,
                    width: options.width,
                    height: options.height,
                    backgroundColor: 0x000000,
                    backgroundAlpha: options.transparent ? 0 : 1,
                    preference: backend,
                    resolution: 1
                })
                // Pixi's preference is only an ordering hint and can silently select WebGL.
                if (!rendererTypeMatchesBackend(app.renderer.type, backend)) throw new Error(`Pixi created renderer type ${app.renderer.type} for ${backend}`)
                return app
            } catch (error) {
                destroyPixiApp(app)
                throw error
            }
        },
        probe: (app) => presentProbeFrame(options.PIXI, app),
        destroy: destroyPixiApp
    })

    return { ...initialized, canvas: activeCanvas }
}

export function destroyPixiApp(app: any): void {
    try {
        app.destroy({ removeView: false }, { children: true, texture: true })
    } catch {
        // Partially initialized graphics applications can reject teardown.
    }
}
