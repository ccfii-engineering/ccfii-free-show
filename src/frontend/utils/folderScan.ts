import type { FolderScanComplete } from "../../types/IPC/Main"
import type { FileFolder } from "../../types/Main"

export type FolderScanResult = Record<string, FileFolder> | FolderScanComplete

export function isFolderScanComplete(result: FolderScanResult | undefined): result is FolderScanComplete {
    return !!result && "status" in result && result.status === "complete" && Number.isInteger(result.entryCount) && result.entryCount >= 0
}
