import type { FolderScanComplete } from "../../../../types/IPC/Main"
import type { FileFolder } from "../../../../types/Main"
import type { IPCRequestResult } from "../../../../types/IPC/Request"

export type FolderScanViewOutcome = {
    state: "complete" | "partial" | "cancelled" | "failed"
    entryCount: number
    detail?: string
}

export function classifyFolderBatch(expectedRequestId: string, lastSequence: number, batch: { requestId: string; batchSequence: number }): "stale" | "next" | "out-of-order" {
    if (batch.requestId !== expectedRequestId) return "stale"
    return batch.batchSequence === lastSequence + 1 ? "next" : "out-of-order"
}

export function getFolderScanViewOutcome(result: IPCRequestResult<FolderScanComplete | Record<string, FileFolder>>, receivedEntryCount: number): FolderScanViewOutcome {
    if (result.status === "success") {
        const data = result.data
        if (data && "status" in data && data.status === "complete" && "entryCount" in data && typeof data.entryCount === "number" && Number.isInteger(data.entryCount) && data.entryCount >= 0) {
            return { state: "complete", entryCount: data.entryCount }
        }

        return {
            state: receivedEntryCount ? "partial" : "failed",
            entryCount: receivedEntryCount,
            detail: "The folder scan ended without a completion result."
        }
    }

    if (result.status === "cancelled") return { state: "cancelled", entryCount: receivedEntryCount }

    const detail = result.status === "timeout" ? "The folder scan timed out." : result.error.message
    return { state: receivedEntryCount ? "partial" : "failed", entryCount: receivedEntryCount, detail }
}
