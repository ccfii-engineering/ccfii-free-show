import { contextBridge, ipcRenderer } from "electron"
import type { PowerPointRendererReply, PowerPointRendererRequest, PowerPointRendererResult } from "../../types/PowerPointRenderer"

// Keep these channels local: this private window must not use the shared UI IPC bus.
const requestChannel = "POWERPOINT_RENDERER_REQUEST"
const replyChannel = "POWERPOINT_RENDERER_REPLY"
const jobToken = process.argv.find((arg) => arg.startsWith("--ppt-job-token="))?.slice("--ppt-job-token=".length) || ""
let listenerRegistered = false

function isRequest(value: unknown): value is PowerPointRendererRequest {
    if (!value || typeof value !== "object") return false
    const request = value as PowerPointRendererRequest
    if (request.jobToken !== jobToken || !request.requestId || typeof request.requestId !== "string") return false
    if (request.operation === "OPEN") return request.bytes instanceof Uint8Array
    if (request.operation === "PAGE") return Number.isInteger(request.pageIndex) && request.pageIndex >= 0
    return request.operation === "CLOSE"
}

contextBridge.exposeInMainWorld("powerPointRenderer", {
    onRequest: (callback: (request: PowerPointRendererRequest) => Promise<PowerPointRendererResult> | PowerPointRendererResult) => {
        if (listenerRegistered || typeof callback !== "function" || !jobToken) return false
        listenerRegistered = true
        ipcRenderer.on(requestChannel, (_event, rawRequest: unknown) => {
            if (!isRequest(rawRequest)) return
            const request = rawRequest
            Promise.resolve()
                .then(() => callback(request))
                .then((result) => {
                    const reply: PowerPointRendererReply = { operation: request.operation, requestId: request.requestId, jobToken, result }
                    ipcRenderer.send(replyChannel, reply)
                })
                .catch((error: unknown) => {
                    const reply: PowerPointRendererReply = {
                        operation: request.operation,
                        requestId: request.requestId,
                        jobToken,
                        error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
                    }
                    ipcRenderer.send(replyChannel, reply)
                })
        })
        return true
    }
})
