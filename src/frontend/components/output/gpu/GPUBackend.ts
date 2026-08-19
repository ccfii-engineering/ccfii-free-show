export const GPU_INITIALIZATION_TIMEOUT_MS = 5000

export type GPUBackend = "webgpu" | "webgl"

export function hasRequiredWebGPUPlatform(platform: any): boolean {
    return !!platform?.navigator?.gpu && !!platform?.GPUTextureUsage
}

export interface GPUBackendResult<T> {
    app: T
    backend: GPUBackend
}

export interface GPUBackendOptions<T> {
    create: (backend: GPUBackend) => Promise<T>
    probe: (app: T, backend: GPUBackend) => Promise<boolean>
    destroy: (app: T) => void | Promise<void>
    timeoutMs?: number
}

const PIXI_WEBGL_RENDERER_TYPE = 1
const PIXI_WEBGPU_RENDERER_TYPE = 2

export function rendererTypeMatchesBackend(rendererType: number, backend: GPUBackend): boolean {
    return rendererType === (backend === "webgpu" ? PIXI_WEBGPU_RENDERER_TYPE : PIXI_WEBGL_RENDERER_TYPE)
}

export async function initializeGPUBackend<T>(options: GPUBackendOptions<T>): Promise<GPUBackendResult<T>> {
    const deadline = Date.now() + (options.timeoutMs ?? GPU_INITIALIZATION_TIMEOUT_MS)
    const backends = ["webgpu", "webgl"] as const

    for (const [index, backend] of backends.entries()) {
        let app: T | null = null
        const attemptsRemaining = backends.length - index
        const attemptDeadline = Date.now() + Math.max(1, Math.floor((deadline - Date.now()) / attemptsRemaining))
        try {
            app = await beforeDeadline(options.create(backend), attemptDeadline, (lateApp) => safelyDestroy(options, lateApp))
            const presented = await beforeDeadline(options.probe(app, backend), attemptDeadline)
            if (!presented) throw new Error(`${backend} did not present the probe frame`)
            return { app, backend }
        } catch {
            if (app) await safelyDestroy(options, app)
        }
    }

    throw new Error("GPU backend initialization failed")
}

async function safelyDestroy<T>(options: GPUBackendOptions<T>, app: T): Promise<void> {
    try {
        await options.destroy(app)
    } catch {
        // A broken graphics driver can also reject cleanup. Do not let that suppress the fresh
        // compatibility-backend attempt or leave a late-created application unobserved.
    }
}

function beforeDeadline<T>(operation: Promise<T>, deadline: number, onLateResolve?: (value: T) => void): Promise<T> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
        operation.then((value) => onLateResolve?.(value)).catch(() => undefined)
        return Promise.reject(new Error("GPU backend initialization timed out"))
    }

    return new Promise((resolve, reject) => {
        let timedOut = false
        const timeout = setTimeout(() => {
            timedOut = true
            reject(new Error("GPU backend initialization timed out"))
        }, remaining)
        operation.then(
            (value) => {
                if (timedOut) {
                    onLateResolve?.(value)
                    return
                }
                clearTimeout(timeout)
                resolve(value)
            },
            (error) => {
                clearTimeout(timeout)
                reject(error)
            }
        )
    })
}
