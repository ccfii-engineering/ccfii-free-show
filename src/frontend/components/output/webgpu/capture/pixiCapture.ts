import type { Application } from "pixi.js"
import { OUTPUT } from "../../../../../types/Channels"
import { send } from "../../../../utils/request"

let captureApp: Application | null = null

export function registerCaptureApp(app: Application): void {
    captureApp = app
}

export function unregisterCaptureApp(): void {
    captureApp = null
}

export async function captureFrame(outputId: string): Promise<void> {
    if (!captureApp) return

    try {
        const canvas = captureApp.renderer.extract.canvas(captureApp.stage) as HTMLCanvasElement
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const buffer = imageData.data.buffer

        send(OUTPUT, ["CAPTURE_BUFFER"], {
            id: outputId,
            time: Date.now(),
            buffer: new Uint8Array(buffer),
            size: { width: canvas.width, height: canvas.height }
        })

        canvas.remove()
    } catch (error) {
        console.warn("pixiCapture: frame capture failed:", error)
    }
}

// Listen for capture requests from main process
export function setupCaptureListener(outputId: string): void {
    // The main process will send CAPTURE_FRAME requests via IPC
    // The output window responds with the pixel buffer
    // This is registered when WebGPUOutput mounts
}
