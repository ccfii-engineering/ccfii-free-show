import type { FileFolder } from "../../types/Main"
import type { TrimmedShows } from "../../types/Show"

export type WorkerInit = {
    type: "INIT"
    cachePath: string
    appDataPath: string
}

export type WorkerRequest = { type: "READ_FOLDER"; requestId: string; paths: string[]; depth: number; captureFolderContent: boolean; generateThumbnails: boolean; batchSize?: number } | { type: "PARSE_SHOWS"; requestId: string; folderPath: string; chunkSize: number }

export type WorkerResponse = { type: "READY" } | { type: "READ_FOLDER_BATCH"; requestId: string; entries: FileFolder[] } | { type: "READ_FOLDER_DONE"; requestId: string } | { type: "PARSE_SHOWS_BATCH"; requestId: string; trimmed: TrimmedShows } | { type: "PARSE_SHOWS_DONE"; requestId: string } | { type: "ERROR"; requestId?: string; message: string }

export type WorkerMessage = WorkerInit | WorkerRequest
