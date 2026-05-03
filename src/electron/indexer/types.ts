import type { FileFolder } from "../../types/Main"

export type WalkOptions = {
    paths: string[]
    depth: number
    captureFolderContent: boolean
    batchSize?: number
    generateThumbnails?: boolean
}

export type WalkBatch = FileFolder[]
export type WalkBatchCallback = (batch: WalkBatch) => void
