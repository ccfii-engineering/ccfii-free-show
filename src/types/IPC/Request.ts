export const IPC_REQUEST_PROTOCOL = "freeshow-ipc-request"
export const IPC_REQUEST_VERSION = 1

export type IPCRequestMetadata = {
    protocol: typeof IPC_REQUEST_PROTOCOL
    version: typeof IPC_REQUEST_VERSION
    kind: "request" | "cancel" | "reply"
    status?: "success" | "error"
    error?: { name: string; message: string }
}

export type IPCRequestResult<T> = { status: "success"; data: T } | { status: "timeout"; execution: "unknown" } | { status: "cancelled"; work: "not-started" | "may-continue" } | { status: "error"; error: { name: string; message: string } }

export type IPCRequestOptions = {
    timeoutMs?: number
    signal?: AbortSignal
}

export type IPCRequestReply<T> = { status: "success"; data: T } | { status: "error"; error: { name: string; message: string } }

type RunIPCRequestOptions<T> = {
    timeoutMs: number
    signal?: AbortSignal
    subscribe: (callback: (reply: IPCRequestReply<T>) => void) => () => void
    send: () => void
    cancel: () => void
}

export function runIPCRequest<T>({ timeoutMs, signal, subscribe, send, cancel }: RunIPCRequestOptions<T>): Promise<IPCRequestResult<T>> {
    if (signal?.aborted) return Promise.resolve({ status: "cancelled", work: "not-started" })

    return new Promise((resolve) => {
        let settled = false
        let timeout: ReturnType<typeof setTimeout> | undefined
        let unsubscribe = () => {}

        const cleanup = () => {
            if (timeout) clearTimeout(timeout)
            signal?.removeEventListener("abort", onAbort)
            unsubscribe()
        }

        const finish = (result: IPCRequestResult<T>) => {
            if (settled) return
            settled = true
            cleanup()
            resolve(result)
        }

        const cancelWork = () => {
            try {
                cancel()
            } catch {
                // Cancellation is best effort; the caller must treat work as possibly continuing.
            }
        }

        const onAbort = () => {
            finish({ status: "cancelled", work: "may-continue" })
            cancelWork()
        }

        try {
            unsubscribe = subscribe((reply) => {
                if (reply.status === "success") finish({ status: "success", data: reply.data })
                else finish({ status: "error", error: reply.error })
            })
            signal?.addEventListener("abort", onAbort, { once: true })
            timeout = setTimeout(() => {
                finish({ status: "timeout", execution: "unknown" })
                cancelWork()
            }, timeoutMs)
            send()
        } catch (error) {
            const reason = error instanceof Error ? error : new Error(String(error))
            finish({ status: "error", error: { name: reason.name, message: reason.message } })
        }
    })
}

export function createIPCRequestMetadata(kind: IPCRequestMetadata["kind"], result?: Pick<IPCRequestMetadata, "status" | "error">): IPCRequestMetadata {
    return {
        protocol: IPC_REQUEST_PROTOCOL,
        version: IPC_REQUEST_VERSION,
        kind,
        ...result
    }
}

export function isIPCRequestMetadata(value: unknown): value is IPCRequestMetadata {
    if (!value || typeof value !== "object") return false
    const metadata = value as IPCRequestMetadata
    return metadata.protocol === IPC_REQUEST_PROTOCOL && metadata.version === IPC_REQUEST_VERSION && ["request", "cancel", "reply"].includes(metadata.kind)
}

export function decodeIPCRequestReply<T>(message: { data?: unknown; ipcRequest?: unknown }): IPCRequestReply<T> | undefined {
    if (!isIPCRequestMetadata(message.ipcRequest) || message.ipcRequest.kind !== "reply") return undefined

    const metadata = message.ipcRequest
    if (metadata.status === "success" && message.data !== undefined) return { status: "success", data: message.data as T }
    if (metadata.status === "error" && metadata.error && typeof metadata.error.name === "string" && typeof metadata.error.message === "string") {
        return { status: "error", error: metadata.error }
    }

    return { status: "error", error: { name: "IPCProtocolError", message: "Malformed IPC request reply" } }
}

export function serializeIPCError(error: unknown): { name: string; message: string } {
    if (error instanceof Error) return { name: error.name || "Error", message: error.message }
    return { name: "Error", message: String(error) }
}
